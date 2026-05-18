const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDb() {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(process.env.MONGODB_DB_NAME || "daily_blog");
  return db;
}

async function getCollection() {
  const database = await connectDb();
  return database.collection(
    process.env.MONGODB_COLLECTION || "visitor_sessions"
  );
}

module.exports = { connectDb, getCollection };
