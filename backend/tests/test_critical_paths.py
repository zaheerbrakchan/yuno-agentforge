import pytest
from httpx import AsyncClient, ASGITransport
from backend.main import app
from backend.db.database import init_db


@pytest.fixture(autouse=True)
async def setup_db():
    await init_db()
    yield


@pytest.mark.asyncio
async def test_health_check():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_create_agent():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/agents/", json={
            "name": "Test Agent",
            "role": "custom",
            "system_prompt": "You are a test agent.",
            "model": "claude-sonnet-4-20250514",
            "tools": [],
            "memory_enabled": True,
            "max_tokens": 500
        })
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test Agent"
    assert "id" in data


@pytest.mark.asyncio
async def test_list_agents():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/agents/")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


@pytest.mark.asyncio
async def test_create_workflow():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/workflows/", json={
            "name": "Test Workflow",
            "description": "A test workflow",
            "graph_json": {}
        })
    assert response.status_code == 200
    assert response.json()["name"] == "Test Workflow"


@pytest.mark.asyncio
async def test_get_workflow_templates():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/workflows/templates")
    assert response.status_code == 200
    templates = response.json()
    assert len(templates) >= 2


@pytest.mark.asyncio
async def test_get_available_tools():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/api/agents/tools/available")
    assert response.status_code == 200
    tools = response.json()
    assert "lookup_payment" in tools
    assert "get_retry_recommendation" in tools


@pytest.mark.asyncio
async def test_custom_payment_saves_playbook():
    from backend.runtime.tools import get_retry_recommendation

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/api/payments/", json={
            "order_id": "ORD-CUSTOM-1",
            "status": "failed",
            "reason": "billing_address_mismatch",
            "recommendation": "Verify your billing address matches your card and retry.",
            "amount": 50,
        })
    assert response.status_code == 200

    result = get_retry_recommendation.invoke({"failure_reason": "billing_address_mismatch"})
    assert "billing address" in result.lower()

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        listing = await client.get("/api/payments/")
    playbook = {p["reason"]: p for p in listing.json()["playbook"]}
    assert "billing_address_mismatch" in playbook
    assert playbook["billing_address_mismatch"]["is_builtin"] is False
