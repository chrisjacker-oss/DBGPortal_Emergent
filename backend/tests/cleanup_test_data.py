"""Remove TEST_ prefixed data created by testing agents (estimates, SOs, invoices,
materials, customers, staff/portal users) and reset shop settings to documented defaults."""
import os
import asyncio
from dotenv import load_dotenv

load_dotenv('/app/backend/.env')
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

RX = {"$regex": "^TEST_"}


async def main():
    d = AsyncIOMotorClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]
    res = {}
    for coll, q in [
        ("estimates", {"title": RX}),
        ("sales_orders", {"title": RX}),
        ("invoices", {"title": RX}),
        ("bills", {"vendor": RX}),
        ("materials", {"name": RX}),
        ("reorders", {"title": RX}),
        ("customers", {"$or": [{"name": RX}, {"email": {"$regex": "^test_"}}]}),
        ("users", {"$or": [{"name": RX}, {"email": {"$regex": "^test_"}}]}),
        ("login_attempts", {"identifier": {"$regex": "test_"}}),
    ]:
        r = await d[coll].delete_many(q)
        res[coll] = r.deleted_count
    await d.settings.update_one({"key": "shop"},
                                {"$set": {"shop_rate_per_hr": 75.0, "machine_rate_per_hr": 25.0,
                                          "default_markup": 40.0}}, upsert=True)
    print("deleted:", res)
    print("settings:", await d.settings.find_one({"key": "shop"}, {"_id": 0}))
    print("remaining users:", [(u.get("email"), u.get("role")) for u in
                               await d.users.find({}, {"email": 1, "role": 1}).to_list(50)])


asyncio.run(main())
