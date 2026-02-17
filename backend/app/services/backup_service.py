"""Atomic backup service using SQLite online backup API."""
import sqlite3
import tempfile
import shutil
import zipfile
import json
from pathlib import Path
from datetime import datetime
from contextlib import contextmanager

from app.core.logging import logger


@contextmanager
def atomic_backup_context(final_path: Path):
    """Context manager for atomic file operations."""
    temp_path = final_path.with_suffix('.tmp')
    try:
        yield temp_path
        # Atomic rename on success
        temp_path.rename(final_path)
    except Exception:
        # Clean up on failure
        if temp_path.exists():
            temp_path.unlink()
        raise


def backup_sqlite_database(source_path: str, dest_path: str) -> None:
    """Create consistent backup using SQLite's online backup API."""
    source = sqlite3.connect(source_path)
    dest = sqlite3.connect(dest_path)
    
    try:
        # This handles concurrent writes safely
        source.backup(dest, pages=100)
        logger.debug("database_backed_up", source=source_path, dest=dest_path)
    finally:
        dest.close()
        source.close()


def create_full_backup(
    data_dir: Path,
    output_path: Path,
    progress_callback=None
) -> dict:
    """Create atomic full project backup."""
    
    try:
        import kraken
        kraken_version = kraken.__version__
    except ImportError:
        kraken_version = "unknown"
    
    manifest = {
        "version": "1.0",
        "app": "Maatik Shemua",
        "created_at": datetime.utcnow().isoformat(),
        "kraken_version": kraken_version,
    }
    
    with atomic_backup_context(output_path) as temp_zip_path:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_dir = Path(temp_dir)
            
            # 1. Backup database atomically
            db_path = data_dir / "maatik.db"
            if db_path.exists():
                db_backup_path = temp_dir / "database.sqlite"
                backup_sqlite_database(str(db_path), str(db_backup_path))
            else:
                db_backup_path = None
            
            # 2. Create ZIP archive
            with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                # Add database
                if db_backup_path and db_backup_path.exists():
                    zf.write(db_backup_path, "database.sqlite")
                
                # Add images
                pages_dir = data_dir / "pages"
                if pages_dir.exists():
                    file_count = 0
                    for img_file in pages_dir.rglob("*"):
                        if img_file.is_file():
                            arcname = f"pages/{img_file.relative_to(pages_dir)}"
                            zf.write(img_file, arcname)
                            file_count += 1
                            if progress_callback:
                                progress_callback("image", str(img_file))
                    manifest["image_count"] = file_count
                
                # Add models
                models_dir = data_dir / "models"
                if models_dir.exists():
                    model_count = 0
                    for model_file in models_dir.rglob("*"):
                        if model_file.is_file():
                            arcname = f"models/{model_file.relative_to(models_dir)}"
                            zf.write(model_file, arcname)
                            model_count += 1
                            if progress_callback:
                                progress_callback("model", str(model_file))
                    manifest["model_count"] = model_count
                
                # Add manifest
                zf.writestr("manifest.json", json.dumps(manifest, indent=2))
    
    logger.info("backup_created", path=str(output_path))
    
    return manifest


def restore_from_backup(backup_path: Path, data_dir: Path) -> dict:
    """Restore from backup ZIP file."""
    
    # Verify backup
    with zipfile.ZipFile(backup_path, 'r') as zf:
        if 'manifest.json' not in zf.namelist():
            raise ValueError("Invalid backup file: missing manifest")
        
        manifest = json.loads(zf.read('manifest.json'))
    
    # Create backup of current data
    current_backup = data_dir / f"pre_restore_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    if data_dir.exists():
        shutil.copytree(data_dir, current_backup)
    
    try:
        # Extract backup
        with zipfile.ZipFile(backup_path, 'r') as zf:
            # Extract database
            if 'database.sqlite' in zf.namelist():
                db_data = zf.read('database.sqlite')
                (data_dir / 'maatik.db').write_bytes(db_data)
            
            # Extract pages
            for name in zf.namelist():
                if name.startswith('pages/'):
                    zf.extract(name, data_dir)
            
            # Extract models
            for name in zf.namelist():
                if name.startswith('models/'):
                    zf.extract(name, data_dir)
        
        logger.info("backup_restored", path=str(backup_path))
        
        # Remove pre-restore backup on success
        if current_backup.exists():
            shutil.rmtree(current_backup)
        
        return manifest
        
    except Exception as e:
        # Restore from pre-restore backup
        if current_backup.exists():
            shutil.rmtree(data_dir)
            shutil.move(current_backup, data_dir)
        raise
