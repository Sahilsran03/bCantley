import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import { createGoogleVerifier } from "../services/googleToken.service.js";
import { createGoogleAuthentication } from "../services/googleAuth.service.js";
import { login, googleLogin } from "../controllers/auth.controller.js";
import { verifyAccessToken, verifyRefreshToken } from "../services/token.service.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" };
const clientId = "test-client.apps.googleusercontent.com";
const claims = { sub: "google-subject", email: "customer@gmail.com", email_verified: true, name: "Test Customer" };
const sign = (changes = {}, options = {}) => jwt.sign({ ...claims, ...changes }, privateKey, { algorithm: "RS256", keyid: "test-key", audience: clientId, issuer: "https://accounts.google.com", expiresIn: "1h", ...options });
let keyRequests = 0;
const fetchKeys = async () => { keyRequests += 1; return { ok: true, headers: { get: () => "max-age=3600" }, json: async () => ({ keys: [jwk] }) }; };
const verify = createGoogleVerifier({ fetchKeys });

test("Google signature and claims are verified offline; public keys are cached", async () => {
  assert.equal((await verify(sign(), clientId)).sub, claims.sub);
  await verify(sign(), clientId);
  assert.equal(keyRequests, 1);
});
for (const [label, token] of [
  ["malformed", "invalid"],
  ["wrong audience", sign({}, { audience: "other-client" })],
  ["wrong issuer", sign({}, { issuer: "https://attacker.invalid" })],
  ["expired", sign({}, { expiresIn: -1 })],
  ["unverified email", sign({ email_verified: false })],
  ["string verified email", sign({ email_verified: "true" })],
  ["missing subject", sign({ sub: "" })],
  ["wrong authorized party", sign({ azp: "other-client" })],
  ["missing expiry", jwt.sign(claims, privateKey, { algorithm: "RS256", keyid: "test-key", audience: clientId, issuer: "https://accounts.google.com" })],
  ["future issued-at", sign({ iat: Math.floor(Date.now() / 1000) + 1000 })],
  ["unknown key", sign({}, { keyid: "unknown" })],
  ["bad signature", jwt.sign(claims, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey, { algorithm: "RS256", keyid: "test-key", audience: clientId, issuer: "https://accounts.google.com", expiresIn: "1h" })]
]) test(`Reject ${label}`, async () => { await assert.rejects(verify(token, clientId), { statusCode: 401 }); });
test("Missing configuration fails closed", async () => { await assert.rejects(verify(sign(), ""), { statusCode: 503 }); });
test("Google key outage returns unavailable without token details", async () => {
  const offline = createGoogleVerifier({ fetchKeys: async () => { throw new Error("secret credential"); } });
  await assert.rejects(offline(sign(), clientId), (error) => error.statusCode === 503 && !error.message.includes("secret"));
});

const store = (initial = []) => {
  const rows = [...initial];
  return { rows, async findOne(query) { return rows.find((row) => Object.entries(query).every(([key, value]) => row[key] === value)) || null; }, async create(data) {
    if (rows.some((row) => row.email === data.email || row.googleId === data.googleId)) throw Object.assign(new Error("duplicate"), { code: 11000 });
    const user = { ...data, _id: "customer-id" }; rows.push(user); return user;
  } };
};
const authenticate = (users, verified = claims) => createGoogleAuthentication({ users, verify: async () => verified });
test("New Google customer and returning customer use stable subject without duplicates", async () => {
  const users = store();
  const first = await authenticate(users)({ credential: "verified" });
  assert.equal(first.created, true); assert.equal(first.user.role, "customer"); assert.equal(first.user.isVerified, true);
  assert.equal(first.user.password, undefined); assert.equal(first.user.phone, undefined);
  const second = await authenticate(users, { ...claims, email: "changed@gmail.com" })({ credential: "verified" });
  assert.equal(second.created, false); assert.equal(second.user, first.user); assert.equal(users.rows.length, 1);
});
test("Concurrent first logins create one account", async () => {
  const users = store(); const auth = authenticate(users);
  const results = await Promise.all([auth({ credential: "verified" }), auth({ credential: "verified" })]);
  assert.equal(users.rows.length, 1); assert.equal(results[0].user, results[1].user);
});
test("Existing local email never silently links or overwrites account data", async () => {
  const original = { email: claims.email, role: "customer", password: "existing-hash", walletBalance: 42, addresses: [{ city: "Delhi" }], isVerified: true };
  const users = store([original]); const before = structuredClone(original);
  await assert.rejects(authenticate(users)({ credential: "verified" }), { statusCode: 409 });
  assert.deepEqual(original, before); assert.equal(users.rows.length, 1);
});
test("Third-party Google email collision is also rejected", async () => {
  await assert.rejects(authenticate(store([{ email: "person@example.com" }]), { ...claims, email: "person@example.com" })({ credential: "verified" }), { statusCode: 409 });
});
for (const user of [{ role: "admin", isVerified: true }, { role: "customer", isVerified: false }]) test(`Linked ${user.role}, verified=${user.isVerified} cannot bypass auth rules`, async () => {
  await assert.rejects(authenticate(store([{ ...user, googleId: claims.sub }]))({ credential: "verified" }), { statusCode: 403 });
});
test("Frontend identity and role input is rejected", async () => {
  await assert.rejects(authenticate(store())({ credential: "verified", role: "admin", email: "attacker@example.com" }), { statusCode: 400 });
});
test("Verification failures cannot query or create users", async () => {
  const auth = createGoogleAuthentication({ verify: async () => { throw Object.assign(new Error("invalid"), { statusCode: 401 }); }, users: { findOne() { assert.fail("Database queried"); } } });
  await assert.rejects(auth({ credential: "invalid" }), { statusCode: 401 });
});
test("Schema allows Google-only users, keeps local required fields and unique provider index", async () => {
  await new User({ name: "Google Customer", email: claims.email, googleId: claims.sub, isVerified: true }).validate();
  await assert.rejects(new User({ name: "Local Customer", email: "local@example.com" }).validate());
  assert.ok(User.schema.indexes().some(([fields, options]) => fields.googleId === 1 && options.unique && options.sparse));
  assert.equal(await new User({ googleId: claims.sub }).comparePassword("password"), false);
});
const invoke = (handler, body) => new Promise((resolve, reject) => {
  const res = { status(code) { this.statusCode = code; return this; }, json(data) { resolve({ status: this.statusCode, data }); } };
  handler({ body }, res, reject);
});
test("Existing password login issues the same Cantley session and rejects wrong passwords", async () => {
  const user = new User({ name: "Local Customer", email: "local@example.com", phone: "1234567890", password: await bcrypt.hash("existing-password", 4), isVerified: true });
  user.save = async () => user;
  const original = User.findOne;
  User.findOne = () => ({ select: async () => user });
  try {
    const response = await invoke(login, { email: user.email, password: "existing-password" });
    assert.equal(response.status, 200); assert.equal(response.data.user.role, "customer");
    assert.equal(verifyAccessToken(response.data.accessToken).userId, user.id);
    assert.equal(verifyRefreshToken(response.data.refreshToken).userId, user.id);
    assert.equal(user.refreshToken, response.data.refreshToken);
    assert.equal(response.data.user.password, undefined);
    await assert.rejects(invoke(login, { email: user.email, password: "wrong" }), { statusCode: 401 });
  } finally { User.findOne = original; }
});
test("Google controller uses existing auth response and refresh-token persistence", async () => {
  const originalFind = User.findOne; const originalCreate = User.create; const originalFetch = globalThis.fetch; const originalClient = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = clientId; globalThis.fetch = fetchKeys;
  let created;
  User.findOne = async () => null;
  User.create = async (data) => { created = new User(data); await created.validate(); created.save = async () => created; return created; };
  try {
    const result = await invoke(googleLogin, { credential: sign() });
    assert.equal(result.status, 201); assert.equal(result.data.success, true); assert.equal(result.data.user.role, "customer");
    assert.equal(verifyAccessToken(result.data.accessToken).userId, created.id);
    assert.equal(verifyRefreshToken(result.data.refreshToken).userId, created.id);
    assert.equal(created.refreshToken, result.data.refreshToken); assert.equal(result.data.user.googleId, undefined);
  } finally {
    User.findOne = originalFind; User.create = originalCreate; globalThis.fetch = originalFetch;
    if (originalClient === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = originalClient;
  }
});
