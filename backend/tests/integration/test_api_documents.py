"""Integration tests for document API."""
import pytest


class TestDocumentAPI:
    """Test document endpoints."""
    
    def test_list_documents_empty(self, client):
        response = client.get("/api/documents")
        assert response.status_code == 200
        data = response.json()
        assert data["items"] == []
        assert data["total"] == 0
    
    def test_get_document_not_found(self, client):
        response = client.get("/api/documents/999")
        assert response.status_code == 404
    
    def test_delete_document_not_found(self, client):
        response = client.delete("/api/documents/999")
        assert response.status_code == 404
    
    def test_health_check(self, client):
        response = client.get("/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
