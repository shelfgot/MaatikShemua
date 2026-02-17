"""Auto-registration of models from filesystem."""
from pathlib import Path
from sqlalchemy.orm import Session
from typing import List

from app.config import MODELS_DIR, BASE_DIR
from app.models import Model
from app.services.kraken_service import validate_and_load_model, get_kraken_version
from app.core.logging import logger


def auto_register_models(db: Session, models_dir: Path = None) -> List[Model]:
    """Scan models directory and auto-register any unregistered models.
    
    Args:
        db: Database session
        models_dir: Directory to scan for models. Defaults to MODELS_DIR/transcription
        
    Returns:
        List of newly registered models
    """
    if models_dir is None:
        # Default to models/transcription subdirectory
        models_dir = MODELS_DIR / "transcription"
    
    models_dir = Path(models_dir)
    if not models_dir.exists():
        logger.warning("models_directory_not_found", path=str(models_dir))
        return []
    
    newly_registered = []
    
    # Scan for .mlmodel files
    model_files = list(models_dir.glob("*.mlmodel"))
    
    if not model_files:
        logger.info("no_models_found", directory=str(models_dir))
        return []
    
    logger.info("scanning_models", directory=str(models_dir), count=len(model_files))
    
    for model_path in model_files:
        try:
            # Check if model already registered (by path)
            existing = db.query(Model).filter(Model.path == str(model_path.resolve())).first()
            if existing:
                logger.debug("model_already_registered", path=str(model_path), model_id=existing.id)
                continue
            
            # Validate and load model to get metadata
            try:
                model_info = validate_and_load_model(str(model_path))
                kraken_version = model_info.get("kraken_version", get_kraken_version())
            except Exception as e:
                logger.warning("model_validation_failed", path=str(model_path), error=str(e))
                continue
            
            # Generate model name from filename (remove extension and underscores)
            model_name = model_path.stem.replace("_", " ")
            
            # Create description based on name
            description = f"Auto-registered recognition model: {model_name}"
            
            # Create model record
            db_model = Model(
                name=model_name,
                path=str(model_path.resolve()),
                type="recognition",  # All models in transcription/ are recognition models
                description=description,
                kraken_version=kraken_version,
                is_default=False,  # Don't auto-set as default
            )
            
            db.add(db_model)
            db.commit()
            
            newly_registered.append(db_model)
            logger.info(
                "model_auto_registered",
                model_id=db_model.id,
                name=model_name,
                path=str(model_path),
                kraken_version=kraken_version
            )
            
        except Exception as e:
            logger.error("model_registration_failed", path=str(model_path), error=str(e))
            db.rollback()
            continue
    
    if newly_registered:
        logger.info("models_auto_registered", count=len(newly_registered))
    else:
        logger.info("no_new_models_to_register")
    
    return newly_registered
