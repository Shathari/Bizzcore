const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const key = crypto.randomBytes(32).toString("hex");
const jwt = crypto.randomBytes(48).toString("hex");

const envPath = path.join("C:/Users/user/ProjectNew/backend", ".env.example");
const outPath = path.join("C:/Users/user/ProjectNew/backend", ".env");

let content = fs.readFileSync(envPath, "utf8");
content = content.replace(
  'JWT_SECRET="change-me-to-a-long-random-string"',
  `JWT_SECRET="${jwt}"`
);
content = content.replace(
  'CREDENTIAL_ENCRYPTION_KEY="replace-with-64-hex-characters"',
  `CREDENTIAL_ENCRYPTION_KEY="${key}"`
);

fs.writeFileSync(outPath, content);
console.log("key length:", key.length, "jwt length:", jwt.length);
console.log("wrote", outPath);
