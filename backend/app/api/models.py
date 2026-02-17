"""Model management API endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Model
from app.schemas import ModelCreate, ModelResponse, ModelListResponse
from app.services.kraken_service import validate_and_load_model, get_kraken_version
from app.core.security import validate_model_path
from app.core.errors import NotFoundError, ValidationError, ModelError
from app.core.logging import logger

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=ModelListResponse)
async def list_models(
    model_type: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """List all available models."""
    query = db.query(Model)
    if model_type:
        query = query.filter(Model.type == model_type)
    
    models = query.order_by(Model.is_default.desc(), Model.name).all()
    
    return ModelListResponse(
        items=[
            ModelResponse(
                id=m.id,
                name=m.name,
                path=m.path,
                type=m.type,
                description=m.description,
                kraken_version=m.kraken_version,
                is_default=m.is_default,
                created_at=m.created_at,
                training_metadata=m.training_metadata,
            )
            for m in models
        ]
    )


@router.post("", response_model=ModelResponse)
async def add_model(
    model_data: ModelCreate,
    db: Session = Depends(get_db)
):
    """Add a new model."""
    # Validate path
    path = validate_model_path(model_data.path)
    
    if not path.exists():
        raise ValidationError(f"Model file not found: {model_data.path}")
    
    # Validate model type
    if model_data.type not in ("segmentation", "recognition"):
        raise ValidationError("Model type must be 'segmentation' or 'recognition'")
    
    # Try to load model and get version info
    try:
        model_info = validate_and_load_model(str(path))
        kraken_version = model_info.get("kraken_version", get_kraken_version())
    except Exception as e:
        raise ModelError(f"Cannot load model: {e}")
    
    # Create model record
    db_model = Model(
        name=model_data.name,
        path=str(path),
        type=model_data.type,
        description=model_data.description,
        kraken_version=kraken_version,
    )
    db.add(db_model)
    db.commit()
    
    logger.info("model_added", model_id=db_model.id, name=model_data.name, type=model_data.type)
    
    return ModelResponse(
        id=db_model.id,
        name=db_model.name,
        path=db_model.path,
        type=db_model.type,
        description=db_model.description,
        kraken_version=db_model.kraken_version,
        is_default=db_model.is_default,
        created_at=db_model.created_at,
        training_metadata=db_model.training_metadata,
    )


@router.get("/{model_id}", response_model=ModelResponse)
async def get_model(
    model_id: int,
    db: Session = Depends(get_db)
):
    """Get model by ID."""
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise NotFoundError(f"Model {model_id} not found")
    
    return ModelResponse(
        id=model.id,
        name=model.name,
        path=model.path,
        type=model.type,
        description=model.description,
        kraken_version=model.kraken_version,
        is_default=model.is_default,
        created_at=model.created_at,
        training_metadata=model.training_metadata,
    )


@router.put("/{model_id}/default")
async def set_default_model(
    model_id: int,
    db: Session = Depends(get_db)
):
    """Set model as default for its type."""
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise NotFoundError(f"Model {model_id} not found")
    
    # Unset other defaults of same type
    db.query(Model).filter(
        Model.type == model.type,
        Model.id != model_id
    ).update({Model.is_default: False})
    
    model.is_default = True
    db.commit()
    
    logger.info("model_set_default", model_id=model_id, type=model.type)
    
    return {"model_id": model_id, "is_default": True}


@router.delete("/{model_id}")
async def delete_model(
    model_id: int,
    db: Session = Depends(get_db)
):
    """Remove model from database (does not delete file)."""
    model = db.query(Model).filter(Model.id == model_id).first()
    if not model:
        raise NotFoundError(f"Model {model_id} not found")
    
    db.delete(model)
    db.commit()
    
    logger.info("model_deleted", model_id=model_id)
    
    return {"status": "deleted", "model_id": model_id}
