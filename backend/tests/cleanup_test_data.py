"""One-off cleanup of TEST_ artifacts created during QA runs."""
import asyncio
from dotenv import dotenv_values
from motor.motor_asyncio import AsyncIOMotorClient

env = dotenv_values("/app/backend/.env")


async def main():
    cl = AsyncIOMotorClient(env["MONGO_URL"])
    db = cl[env["DB_NAME"]]
    for coll, q in [
        ("materials", {"name": {"$regex": "^TEST_"}}),
        ("customers", {"$or": [{"name": {"$regex": "^TEST_"}}, {"company": {"$regex": "^TEST_"}}]}),
        ("estimates", {"title": {"$regex": "^TEST_"}}),
        ("invoices", {"title": {"$regex": "^TEST_"}}),
        ("bills", {"vendor": {"$regex": "^TEST_"}}),
        ("reorders", {"title": {"$regex": "^TEST_"}}),
        ("users", {"email": {"$regex": "^test_"}}),
        ("login_attempts", {"identifier": {"$regex": "test_"}}),
    ]:
        res = await db[coll].delete_many(q)
        print(coll, "deleted", res.deleted_count)
    cl.close()


asyncio.run(main())
