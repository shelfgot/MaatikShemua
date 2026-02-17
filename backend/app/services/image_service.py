"""Image processing service for color space normalization and pyramid generation."""
import io
import hashlib
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from PIL import Image, ImageCms

from app.core.logging import logger
from app.config import TARGET_DPI, THUMBNAIL_SIZE

# Standard sRGB profile
try:
    SRGB_PROFILE = ImageCms.createProfile('sRGB')
except:
    SRGB_PROFILE = None


def normalize_image_color_space(image_path: str, output_path: str) -> Dict:
    """Convert image to sRGB color space and return metadata."""
    
    img = Image.open(image_path)
    metadata = {
        "original_mode": img.mode,
        "original_dpi": img.info.get('dpi', (72, 72)),
        "original_color_space": "unknown",
        "width": img.width,
        "height": img.height,
    }
    
    # Store DPI as single value
    dpi = img.info.get('dpi', (72, 72))
    if isinstance(dpi, tuple):
        metadata["original_dpi"] = int(dpi[0])
    else:
        metadata["original_dpi"] = int(dpi)
    
    # Extract ICC profile if present
    icc_profile = img.info.get('icc_profile')
    
    if icc_profile and SRGB_PROFILE:
        try:
            input_profile = ImageCms.ImageCmsProfile(io.BytesIO(icc_profile))
            profile_name = ImageCms.getProfileDescription(input_profile)
            metadata["original_color_space"] = profile_name
            
            # Convert to sRGB if not already
            if "sRGB" not in profile_name:
                img = ImageCms.profileToProfile(
                    img, input_profile, SRGB_PROFILE,
                    renderingIntent=ImageCms.Intent.PERCEPTUAL
                )
                logger.debug("color_space_converted", from_cs=profile_name, to_cs="sRGB")
        except Exception as e:
            metadata["color_space_warning"] = f"Could not process ICC profile: {e}"
    
    # Handle different image modes
    if img.mode == 'L':
        metadata["original_color_space"] = "grayscale"
        img = img.convert('RGB')
    elif img.mode == 'RGBA':
        # Flatten alpha channel onto white background
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode == 'P':
        img = img.convert('RGB')
    elif img.mode != 'RGB':
        img = img.convert('RGB')
    
    # Save as PNG with sRGB profile
    if SRGB_PROFILE:
        img.save(output_path, 'PNG', icc_profile=ImageCms.ImageCmsProfile(SRGB_PROFILE).tobytes())
    else:
        img.save(output_path, 'PNG')
    
    return metadata


def generate_thumbnail(image_path: str, output_path: str, size: int = THUMBNAIL_SIZE):
    """Generate thumbnail for page tile display."""
    img = Image.open(image_path)
    img.thumbnail((size, size), Image.Resampling.LANCZOS)
    img.save(output_path, 'JPEG', quality=85)


def generate_image_pyramid(image_path: str, output_dir: str, tiles_key: Optional[str] = None) -> Optional[str]:
    """Generate Deep Zoom tiles for fast viewing in OpenSeadragon."""
    try:
        import pyvips

        image = pyvips.Image.new_from_file(image_path)

        # Avoid collisions: each page gets its own tiles folder.
        key = tiles_key or Path(image_path).stem
        tiles_path = Path(output_dir) / "tiles" / key
        tiles_path.mkdir(parents=True, exist_ok=True)

        # Generate Deep Zoom Image (DZI) format
        dzi_path = tiles_path / "image"
        image.dzsave(
            str(dzi_path),
            suffix=".jpg",
            tile_size=256,
            overlap=1,
            depth="onetile",
        )

        return str(dzi_path) + ".dzi"
    except (ImportError, OSError):
        # Missing pyvips or native libvips. Log and continue without tiles
        logger.warning(
            "pyvips_not_available",
            message="Skipping tile generation; libvips/pyvips not available",
        )
        return None


def _slugify_stem(name: str) -> str:
    stem = Path(name).stem
    stem = stem.strip().lower()
    stem = re.sub(r"\s+", "_", stem)
    stem = re.sub(r"[^a-z0-9_\-]+", "_", stem)
    stem = re.sub(r"_+", "_", stem).strip("_")
    return stem or "page"


def _sha256_hex_prefix(path: Path, n: int = 8) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:n]


def validate_image_for_processing(image_path: str) -> Tuple[bool, Optional[str]]:
    """Validate image is suitable for HTR processing."""
    img = Image.open(image_path)
    
    # Check minimum dimensions
    if img.width < 100 or img.height < 100:
        return False, f"Image too small: {img.width}x{img.height} (min 100x100)"
    
    # Check for unusual aspect ratios
    aspect = img.width / img.height
    if aspect > 10 or aspect < 0.1:
        return True, f"Warning: unusual aspect ratio {aspect:.2f}"
    
    # Check DPI for coordinate accuracy
    dpi = img.info.get('dpi', (72, 72))
    if isinstance(dpi, tuple):
        dpi = dpi[0]
    if dpi < 150:
        return True, f"Warning: low DPI ({dpi}) may affect accuracy"
    
    return True, None


def process_uploaded_file(
    file_path: str,
    output_dir: str,
    document_id: int,
    original_filename: Optional[str] = None,
) -> List[Dict]:
    """Process uploaded file and extract pages."""
    from pathlib import Path
    
    file_path = Path(file_path)
    output_dir = Path(output_dir)
    ext = file_path.suffix.lower()
    
    pages_data = []
    
    if ext == '.pdf':
        pages_data = extract_pdf_pages(str(file_path), str(output_dir))
    elif ext in ('.tif', '.tiff'):
        pages_data = extract_tiff_pages(str(file_path), str(output_dir))
    else:
        # Single image
        pages_data = [process_single_image(str(file_path), str(output_dir), 1, original_filename=original_filename or file_path.name)]
    
    return pages_data


def extract_pdf_pages(pdf_path: str, output_dir: str) -> List[Dict]:
    """Extract pages from PDF."""
    import fitz  # PyMuPDF
    
    pages_data = []
    doc = fitz.open(pdf_path)
    
    for page_num in range(len(doc)):
        page = doc[page_num]
        
        # Render at 300 DPI
        zoom = 300 / 72
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat)
        
        # Save as PNG
        output_path = Path(output_dir) / f"page_{page_num + 1:04d}.png"
        pix.save(str(output_path))
        
        # Generate thumbnail
        thumb_path = Path(output_dir) / f"page_{page_num + 1:04d}_thumb.jpg"
        generate_thumbnail(str(output_path), str(thumb_path))
        
        # Generate tiles (per-page folder)
        tiles_path = generate_image_pyramid(str(output_path), str(output_dir), tiles_key=output_path.stem)
        
        pages_data.append({
            "page_number": page_num + 1,
            "image_path": str(output_path),
            "tiles_path": tiles_path,
            "original_dpi": 300,
            "color_space": "sRGB",
        })
    
    doc.close()
    logger.info("pdf_extracted", pages=len(pages_data))
    
    return pages_data


def extract_tiff_pages(tiff_path: str, output_dir: str) -> List[Dict]:
    """Extract pages from multi-page TIFF."""
    from PIL import Image
    
    pages_data = []
    img = Image.open(tiff_path)
    
    page_num = 0
    while True:
        try:
            img.seek(page_num)
            
            # Save as PNG
            output_path = Path(output_dir) / f"page_{page_num + 1:04d}.png"
            
            # Normalize color space
            metadata = normalize_image_color_space(tiff_path, str(output_path))
            
            # Generate thumbnail
            thumb_path = Path(output_dir) / f"page_{page_num + 1:04d}_thumb.jpg"
            generate_thumbnail(str(output_path), str(thumb_path))
            
            # Generate tiles (per-page folder)
            tiles_path = generate_image_pyramid(str(output_path), str(output_dir), tiles_key=output_path.stem)
            
            pages_data.append({
                "page_number": page_num + 1,
                "image_path": str(output_path),
                "tiles_path": tiles_path,
                "original_dpi": metadata.get("original_dpi", 72),
                "color_space": metadata.get("original_color_space", "unknown"),
            })
            
            page_num += 1
            
        except EOFError:
            break
    
    logger.info("tiff_extracted", pages=len(pages_data))
    
    return pages_data


def process_single_image(image_path: str, output_dir: str, page_number: int, original_filename: Optional[str] = None) -> Dict:
    """Process a single image file."""
    src = Path(image_path)
    slug = _slugify_stem(original_filename or src.name)
    h8 = _sha256_hex_prefix(src, n=8)
    out_stem = f"{slug}-{h8}"
    output_path = Path(output_dir) / f"{out_stem}.png"
    
    # Normalize color space
    if output_path.exists():
        # Dedup by content hash: reuse existing normalized image.
        metadata = {}
    else:
        metadata = normalize_image_color_space(image_path, str(output_path))
    
    # Generate thumbnail
    thumb_path = Path(output_dir) / f"{out_stem}_thumb.jpg"
    if not thumb_path.exists():
        generate_thumbnail(str(output_path), str(thumb_path))
    
    # Generate tiles
    tiles_path = generate_image_pyramid(str(output_path), str(output_dir), tiles_key=out_stem)
    
    return {
        "page_number": page_number,
        "image_path": str(output_path),
        "tiles_path": tiles_path,
        "original_dpi": metadata.get("original_dpi", 72),
        "color_space": metadata.get("original_color_space", "unknown"),
    }
