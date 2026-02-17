"""IIIF manifest fetching and parsing service."""
import httpx
from typing import Dict, List, Optional
from pathlib import Path

from app.core.logging import logger
from app.core.security import validate_external_url


def fetch_and_parse_manifest(manifest_url: str) -> Dict:
    """Fetch and parse IIIF manifest."""
    
    # Validate URL
    validate_external_url(manifest_url)
    
    # Fetch manifest
    try:
        response = httpx.get(manifest_url, timeout=30.0, follow_redirects=True)
        response.raise_for_status()
        manifest_data = response.json()
    except httpx.TimeoutException:
        raise ValueError(f"Timeout fetching manifest: {manifest_url}")
    except httpx.HTTPStatusError as e:
        raise ValueError(f"HTTP error fetching manifest: {e.response.status_code}")
    except Exception as e:
        raise ValueError(f"Error fetching manifest: {e}")
    
    # Parse manifest
    result = {
        "label": "",
        "shelfmark": None,
        "repository": None,
        "metadata": {},
        "images": [],
    }
    
    # Handle different IIIF versions
    if "@context" in manifest_data:
        context = manifest_data.get("@context", "")
        if "presentation/3" in str(context):
            result = parse_iiif_v3_manifest(manifest_data)
        else:
            result = parse_iiif_v2_manifest(manifest_data)
    else:
        result = parse_iiif_v3_manifest(manifest_data)
    
    logger.info("iiif_manifest_parsed", url=manifest_url, images=len(result.get("images", [])))
    
    return result


def parse_iiif_v3_manifest(manifest: Dict) -> Dict:
    """Parse IIIF Presentation API 3.0 manifest."""
    
    result = {
        "label": get_localized_value(manifest.get("label", {})),
        "shelfmark": None,
        "repository": None,
        "metadata": {},
        "images": [],
    }
    
    # Extract metadata
    for item in manifest.get("metadata", []):
        label = get_localized_value(item.get("label", {}))
        value = get_localized_value(item.get("value", {}))
        result["metadata"][label] = value
        
        if "shelfmark" in label.lower() or "identifier" in label.lower():
            result["shelfmark"] = value
        if "repository" in label.lower() or "institution" in label.lower():
            result["repository"] = value
    
    # Extract canvases/images
    for canvas in manifest.get("items", []):
        if canvas.get("type") != "Canvas":
            continue
        
        for annotation_page in canvas.get("items", []):
            for annotation in annotation_page.get("items", []):
                body = annotation.get("body", {})
                if body.get("type") == "Image":
                    image_url = body.get("id", "")
                    if image_url:
                        result["images"].append({
                            "url": image_url,
                            "width": body.get("width"),
                            "height": body.get("height"),
                            "format": body.get("format", "image/jpeg"),
                        })
    
    return result


def parse_iiif_v2_manifest(manifest: Dict) -> Dict:
    """Parse IIIF Presentation API 2.0 manifest."""
    
    result = {
        "label": manifest.get("label", ""),
        "shelfmark": None,
        "repository": None,
        "metadata": {},
        "images": [],
    }
    
    # Handle label as string or object
    if isinstance(result["label"], dict):
        result["label"] = get_localized_value(result["label"])
    
    # Extract metadata
    for item in manifest.get("metadata", []):
        label = item.get("label", "")
        value = item.get("value", "")
        if isinstance(label, dict):
            label = get_localized_value(label)
        if isinstance(value, dict):
            value = get_localized_value(value)
        
        result["metadata"][label] = value
        
        if "shelfmark" in label.lower() or "identifier" in label.lower():
            result["shelfmark"] = value
        if "repository" in label.lower() or "institution" in label.lower():
            result["repository"] = value
    
    # Extract canvases/images
    for sequence in manifest.get("sequences", []):
        for canvas in sequence.get("canvases", []):
            for image in canvas.get("images", []):
                resource = image.get("resource", {})
                image_url = resource.get("@id", "")
                if image_url:
                    result["images"].append({
                        "url": image_url,
                        "width": resource.get("width"),
                        "height": resource.get("height"),
                        "format": resource.get("format", "image/jpeg"),
                    })
    
    return result


def get_localized_value(value) -> str:
    """Extract localized value from IIIF label/value objects."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return value[0] if value else ""
    if isinstance(value, dict):
        # Try common language keys
        for lang in ["en", "none", "und"]:
            if lang in value:
                v = value[lang]
                return v[0] if isinstance(v, list) else v
        # Return first value
        for v in value.values():
            return v[0] if isinstance(v, list) else v
    return str(value)


def download_iiif_images(image_url: str, output_dir: str, filename: str) -> str:
    """Download image from IIIF server."""
    
    # Validate URL
    validate_external_url(image_url)
    
    # If it's a IIIF Image API URL, request a reasonable size
    if "/full/" in image_url or "iiif" in image_url.lower():
        # Request full image at default quality
        if not image_url.endswith(('/default.jpg', '/default.png')):
            # Try to construct a proper IIIF URL
            base_url = image_url.split('/full/')[0] if '/full/' in image_url else image_url
            image_url = f"{base_url}/full/max/0/default.jpg"
    
    # Download image
    try:
        response = httpx.get(image_url, timeout=60.0, follow_redirects=True)
        response.raise_for_status()
    except Exception as e:
        raise ValueError(f"Error downloading image: {e}")
    
    # Save image
    output_path = Path(output_dir) / filename
    output_path.write_bytes(response.content)
    
    logger.debug("iiif_image_downloaded", url=image_url, path=str(output_path))
    
    return str(output_path)
