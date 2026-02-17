"""Kraken HTR service for line detection and OCR."""
from typing import Callable, Dict, List, Optional, Any, Tuple
from pathlib import Path
from PIL import Image
from packaging import version

from app.core.model_cache import model_cache
from app.core.errors import ModelError, ImageProcessingError
from app.core.logging import logger

# Try to import Kraken
try:
    import kraken
    from kraken import blla, rpred
    from kraken.lib import models as kraken_models
    from kraken.lib import vgsl
    KRAKEN_AVAILABLE = True
    # Get version using importlib.metadata (kraken 5+ doesn't have __version__)
    try:
        from importlib.metadata import version as get_version
        KRAKEN_VERSION = get_version("kraken")
    except Exception:
        KRAKEN_VERSION = getattr(kraken, "__version__", "0.0.0")
except ImportError:
    KRAKEN_AVAILABLE = False
    KRAKEN_VERSION = "0.0.0"
    logger.warning("kraken_not_available", message="Kraken HTR not installed")

# Known breaking version boundaries
BREAKING_VERSIONS = [
    ("4.0.0", "Models trained before 4.0 may not load"),
    ("5.0.0", "New model format introduced"),
]


def get_kraken_version() -> str:
    """Get current Kraken version."""
    return KRAKEN_VERSION


def check_model_compatibility(model_kraken_version: str) -> Tuple[bool, Optional[str]]:
    """Check if a model is compatible with current Kraken version."""
    if not model_kraken_version:
        return True, "Unknown model version - compatibility not guaranteed"
    
    current = version.parse(KRAKEN_VERSION)
    model_ver = version.parse(model_kraken_version)
    
    # Check for breaking version boundaries
    for break_ver, message in BREAKING_VERSIONS:
        break_v = version.parse(break_ver)
        if model_ver < break_v <= current:
            return False, f"Incompatible: {message}"
        if current < break_v <= model_ver:
            return False, f"Model requires newer Kraken: {message}"
    
    # Warn if major version differs
    if current.major != model_ver.major:
        return True, f"Warning: Major version mismatch (model: {model_ver}, current: {current})"
    
    return True, None


def get_cached_model(path: str, model_type: str = "recognition") -> Any:
    """Get model from cache or load and cache it.
    
    Args:
        path: Path to the model file
        model_type: Either "recognition" or "segmentation"
    """
    from pathlib import Path
    
    cache_key = f"{model_type}:{path}"
    model = model_cache.get(cache_key)
    if model is None:
        if not KRAKEN_AVAILABLE:
            raise ModelError("Kraken not installed")
        
        # Resolve path to absolute
        path_obj = Path(path)
        if not path_obj.is_absolute():
            path_obj = path_obj.resolve()
        resolved_path = str(path_obj)
        
        try:
            if model_type == "segmentation":
                # Segmentation models use vgsl.TorchVGSLModel
                model = vgsl.TorchVGSLModel.load_model(resolved_path)
            else:
                # Recognition models use load_any
                model = kraken_models.load_any(resolved_path)
            model_cache.put(cache_key, model)
            logger.info("model_loaded", path=resolved_path, type=model_type)
        except Exception as e:
            raise ModelError(f"Failed to load model: {e}", details={"path": resolved_path, "type": model_type})
    
    return model


def validate_and_load_model(path: str, model_type: str = None) -> Dict:
    """Validate model can be loaded and return info.
    
    Args:
        path: Path to the model file
        model_type: Either "recognition" or "segmentation". If None, auto-detect.
    """
    if not KRAKEN_AVAILABLE:
        return {"kraken_version": "unknown", "status": "kraken_not_available"}
    
    try:
        # Try to load as vgsl model first (works for both types)
        model = vgsl.TorchVGSLModel.load_model(path)
        detected_type = getattr(model, 'model_type', 'unknown')
        kraken_ver = KRAKEN_VERSION
        
        # Validate type if specified
        if model_type and detected_type != model_type:
            raise ModelError(f"Model is type '{detected_type}', expected '{model_type}'")
        
        return {
            "kraken_version": kraken_ver,
            "model_type": detected_type,
            "status": "valid",
        }
    except ModelError:
        raise
    except Exception as e:
        raise ModelError(f"Cannot load model: {e}", details={"path": path})


def detect_lines_on_page(image_path: str, model_id: Optional[int], db) -> List[Dict]:
    """Run line detection on an image."""
    if not KRAKEN_AVAILABLE:
        raise ModelError("Kraken not installed")
    
    from app.models import Model
    from app.config import MODELS_DIR
    
    # Get segmentation model
    if model_id:
        model_record = db.query(Model).filter(Model.id == model_id).first()
        if not model_record or model_record.type != "segmentation":
            raise ModelError("Invalid segmentation model")
        model_path = model_record.path
    else:
        # Use default model from database
        model_record = db.query(Model).filter(
            Model.type == "segmentation",
            Model.is_default == True
        ).first()
        
        if model_record:
            model_path = model_record.path
        else:
            # Use bundled default model (workaround for kraken 6.0+ importlib.resources issue)
            default_model_path = Path(MODELS_DIR) / "segmentation" / "blla.mlmodel"
            if default_model_path.exists():
                model_path = str(default_model_path)
                logger.info("using_bundled_segmentation_model", path=model_path)
            else:
                raise ModelError("No segmentation model available. Please add blla.mlmodel to models directory.")
    
    # Open image
    try:
        im = Image.open(image_path)
    except Exception as e:
        raise ImageProcessingError(f"Cannot open image: {e}", details={"path": image_path})
    
    # Run segmentation with explicit model
    try:
        model = get_cached_model(model_path, model_type="segmentation")
        baseline_seg = blla.segment(im, model=model)
    except Exception as e:
        raise ImageProcessingError(f"Line detection failed: {e}", details={"path": image_path})
    
    # Convert to serializable format
    lines = []
    for i, line in enumerate(baseline_seg.lines):
        lines.append({
            "line_number": i,
            "baseline": [[int(p[0]), int(p[1])] for p in line.baseline],
            "boundary": [[int(p[0]), int(p[1])] for p in line.boundary] if line.boundary else [],
        })
    
    logger.info("lines_detected", image_path=image_path, line_count=len(lines))
    
    return lines


def run_inference_on_page(page, model_record, db) -> List[Dict]:
    """Run OCR inference on a page."""
    if not KRAKEN_AVAILABLE:
        raise ModelError("Kraken not installed")
    
    from app.models import LineData
    
    # Get line data
    line_data = db.query(LineData).filter(LineData.page_id == page.id).first()
    if not line_data:
        raise ImageProcessingError("No line data for page", details={"page_id": page.id})
    
    # Load image
    try:
        im = Image.open(page.image_path)
    except Exception as e:
        raise ImageProcessingError(f"Cannot open image: {e}", details={"path": page.image_path})
    
    # Load model
    model = get_cached_model(model_record.path)
    
    # Prepare line data for Kraken
    from kraken.containers import Segmentation, BaselineLine
    
    lines = []
    for line in line_data.bounding_boxes:
        baseline = [(int(p[0]), int(p[1])) for p in line.get("baseline", [])]
        boundary = [(int(p[0]), int(p[1])) for p in line.get("boundary", [])]
        lines.append(BaselineLine(
            id=str(line.get("line_number", 0)),
            baseline=baseline,
            boundary=boundary
        ))
    
    seg = Segmentation(
        type='baselines',
        imagename=page.image_path,
        text_direction='horizontal-rl',
        script_detection=False,
        lines=lines
    )
    
    # Run recognition
    try:
        results = []
        for record in rpred.rpred(model, im, seg):
            # Calculate average confidence for the line
            confidences = record.confidences if hasattr(record, 'confidences') else []
            avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0
            
            results.append({
                "text": record.prediction,
                "confidence": avg_confidence,
            })
    except Exception as e:
        raise ImageProcessingError(f"Recognition failed: {e}", details={"page_id": page.id})
    
    logger.info("inference_complete", page_id=page.id, lines=len(results))
    
    return results


def _points_to_page_xml(points: List) -> str:
    """Format a list of [x,y] or (x,y) points as PAGE XML points attribute."""
    return " ".join(f"{int(p[0])},{int(p[1])}" for p in points)


def _write_page_xml(
    xml_path: Path,
    image_path: str,
    image_size: Tuple[int, int],
    lines: List[Dict],
) -> None:
    """Write a single Page XML file for Kraken training (baseline + boundary + text per line)."""
    from lxml import etree

    NS = "http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15"
    nsmap = {None: NS}
    width, height = image_size

    # Collect all boundary points to compute region bounding box (silences "Region r1 without coordinates")
    all_points = []
    for line in lines:
        boundary = line.get("boundary") or []
        for p in boundary:
            all_points.append((float(p[0]), float(p[1])))
    if all_points:
        xs = [p[0] for p in all_points]
        ys = [p[1] for p in all_points]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        region_coords = [
            (min_x, min_y), (max_x, min_y), (max_x, max_y), (min_x, max_y)
        ]
    else:
        region_coords = [(0, 0), (width, 0), (width, height), (0, height)]

    root = etree.Element(f"{{{NS}}}PcGts", nsmap=nsmap)
    page = etree.SubElement(root, f"{{{NS}}}Page", {
        "imageFilename": str(Path(image_path).resolve()),
        "imageWidth": str(width),
        "imageHeight": str(height),
    })
    region = etree.SubElement(page, f"{{{NS}}}TextRegion", {"id": "r1"})
    etree.SubElement(region, f"{{{NS}}}Coords", {"points": _points_to_page_xml(region_coords)})
    for i, line in enumerate(lines):
        baseline = line.get("baseline") or []
        boundary = line.get("boundary") or []
        text = (line.get("text") or "").strip()
        if not baseline or not boundary or text == "":
            continue
        text_line = etree.SubElement(region, f"{{{NS}}}TextLine", {"id": f"l{i+1}"})
        etree.SubElement(text_line, f"{{{NS}}}Baseline", {"points": _points_to_page_xml(baseline)})
        etree.SubElement(text_line, f"{{{NS}}}Coords", {"points": _points_to_page_xml(boundary)})
        te = etree.SubElement(text_line, f"{{{NS}}}TextEquiv")
        etree.SubElement(te, f"{{{NS}}}Unicode").text = text
    tree = etree.ElementTree(root)
    tree.write(
        str(xml_path),
        encoding="utf-8",
        xml_declaration=True,
        method="xml",
        pretty_print=True,
    )


def fine_tune_model(
    base_model_path: str,
    training_data: List[Dict],
    output_name: str,
    output_dir: str,
    min_epochs: Optional[int] = None,
    max_epochs: Optional[int] = None,
    progress_callback: Optional[Callable[[int, int], None]] = None,
) -> str:
    """Fine-tune a model with new training data using Kraken ketos training.

    Builds temporary Page XML files from training_data (image_path + lines with
    baseline, boundary, text), runs recognition training via Kraken's Python API,
    and saves the best model to output_dir. The base model is never modified.

    Args:
        base_model_path: Path to the base model file (will NOT be modified)
        training_data: List of dicts with "image_path" and "lines" (each line: text, baseline, boundary)
        output_name: Name for the fine-tuned model (without extension)
        output_dir: Directory to save the fine-tuned model
        min_epochs: Minimum epochs (default 5). Use 1 for quick smoke tests.
        max_epochs: Maximum epochs (default 100).
        progress_callback: Optional callback(current_epoch_1based, max_epochs) called after each epoch.

    Returns:
        Path to the saved fine-tuned model file
    """
    if not KRAKEN_AVAILABLE:
        raise ModelError("Kraken not installed")

    from datetime import datetime
    import shutil
    import tempfile

    base_model_path_obj = Path(base_model_path).resolve()
    output_dir_obj = Path(output_dir).resolve()

    # Validate training data: need at least one page with lines that have baseline and boundary
    if not training_data:
        raise ModelError("No training data provided")
    total_lines = 0
    for page in training_data:
        image_path = page.get("image_path")
        lines = page.get("lines") or []
        if not image_path or not lines:
            continue
        for line in lines:
            if (line.get("baseline") and line.get("boundary") and (line.get("text") or "").strip()):
                total_lines += 1
    if total_lines == 0:
        raise ModelError(
            "No valid training lines (each line must have text, baseline, and boundary)"
        )

    # Ensure base model exists
    if not base_model_path_obj.exists():
        raise ModelError(f"Base model not found: {base_model_path}")

    # Ensure output directory exists
    output_dir_obj.mkdir(parents=True, exist_ok=True)

    if base_model_path_obj.parent.resolve() == output_dir_obj.resolve():
        output_dir_obj = output_dir_obj / "finetuned"
        output_dir_obj.mkdir(parents=True, exist_ok=True)
        logger.info(
            "using_finetuned_subdirectory",
            base_dir=str(base_model_path_obj.parent),
            finetuned_dir=str(output_dir_obj),
        )

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_filename = output_name.replace(" ", "_").replace("/", "_")
    output_filename = f"{base_filename}_{timestamp}.mlmodel"
    output_path = output_dir_obj / output_filename

    if output_path.resolve() == base_model_path_obj.resolve():
        raise ModelError("Output path would overwrite base model")

    counter = 1
    while output_path.exists():
        output_filename = f"{base_filename}_{timestamp}_{counter}.mlmodel"
        output_path = output_dir_obj / output_filename
        counter += 1
        if counter > 1000:
            raise ModelError("Could not generate unique output filename")

    tmpdir = Path(tempfile.mkdtemp(prefix="kraken_finetune_"))
    try:
        # Write Page XML files (one per page)
        xml_paths = []
        for idx, page in enumerate(training_data):
            image_path = page.get("image_path")
            lines = page.get("lines") or []
            if not image_path or not lines:
                continue
            # Skip lines without geometry
            valid_lines = [
                l for l in lines
                if l.get("baseline") and l.get("boundary") and (l.get("text") or "").strip()
            ]
            if not valid_lines:
                continue
            try:
                im = Image.open(image_path)
                image_size = im.size  # (width, height)
                im.close()
            except Exception as e:
                logger.warning("skip_page_image", path=image_path, error=str(e))
                continue
            xml_path = tmpdir / f"page_{idx:04d}.xml"
            _write_page_xml(xml_path, image_path, image_size, valid_lines)
            xml_paths.append(str(xml_path))

        if not xml_paths:
            raise ModelError("No valid pages could be written (check image paths and line geometry)")

        # Run Kraken recognition training via Python API
        import torch
        from kraken.lib.train import RecognitionModel, KrakenTrainer
        from kraken.lib import default_specs

        # CTC loss is not implemented on MPS; use CPU for training when MPS is available
        use_cpu_for_training = getattr(
            torch.backends.mps, "is_available", lambda: False
        )()
        accelerator = "cpu" if use_cpu_for_training else "auto"
        if use_cpu_for_training:
            logger.info("using_cpu_for_training", reason="MPS does not support CTC loss")

        hyper_params = default_specs.RECOGNITION_HYPER_PARAMS.copy()
        hyper_params.update({
            "epochs": -1,
            "min_epochs": min_epochs if min_epochs is not None else 5,
            "lag": 5,
            "quit": "early",
            "freeze_backbone": 0,
            "warmup": 0,
        })
        trainer_min_epochs = hyper_params["min_epochs"]
        trainer_max_epochs = max_epochs if max_epochs is not None else 100

        callbacks_list = []
        if progress_callback is not None:
            try:
                import lightning.pytorch as pl
            except ImportError:
                import pytorch_lightning as pl

            class _EpochProgressCallback(pl.Callback):
                def __init__(self, cb, max_epochs_val):
                    self._cb = cb
                    self._max_epochs = max_epochs_val

                def on_train_epoch_end(self, trainer, pl_module):
                    # current_epoch is 0-based; report 1-based for progress bar
                    if trainer.current_epoch is not None and self._max_epochs is not None:
                        self._cb(int(trainer.current_epoch) + 1, self._max_epochs)

            callbacks_list = [_EpochProgressCallback(progress_callback, trainer_max_epochs)]

        model = RecognitionModel(
            model=str(base_model_path_obj),
            training_data=xml_paths,
            output=str(tmpdir / "model"),
            format_type="page",
            resize="new",
            partition=0.9,
            hyper_params=hyper_params,
            load_hyper_parameters=False,
            num_workers=0,
        )
        trainer_kw = dict(
            accelerator=accelerator,
            devices=1,
            min_epochs=trainer_min_epochs,
            max_epochs=trainer_max_epochs,
            enable_progress_bar=True,
            enable_summary=False,
        )
        if callbacks_list:
            trainer_kw["callbacks"] = callbacks_list
        trainer = KrakenTrainer(**trainer_kw)
        trainer.fit(model)

        if model.best_epoch == -1:
            raise ModelError("Training did not improve the model (best_epoch == -1)")
        best_path = Path(model.best_model)
        if not best_path.exists():
            raise ModelError(f"Best model file not found: {model.best_model}")
        shutil.copy2(best_path, output_path)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    logger.info(
        "model_fine_tuned",
        base_model=str(base_model_path_obj),
        output=str(output_path),
        output_dir=str(output_dir_obj),
        training_samples=len(training_data),
        total_lines=total_lines,
    )
    return str(output_path)
