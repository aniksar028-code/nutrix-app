
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json"
    }
  });

const enc = (s) => new TextEncoder().encode(s);

const b64 = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

function decodeB64(value) {
  let s = value.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: enc(salt),
      iterations: 180000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return b64(bits);
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const body = b64(enc(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    enc(body)
  );

  return body + "." + b64(signature);
}

async function verify(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return null;

    const [body, signature] = parts;

    const key = await crypto.subtle.importKey(
      "raw",
      enc(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeB64(signature),
      enc(body)
    );

    if (!valid) return null;

    const payload = JSON.parse(
      new TextDecoder().decode(decodeB64(body))
    );

    return payload.exp > Date.now() / 1000
      ? payload
      : null;
  } catch {
    return null;
  }
}

async function getUser(req, env) {
  const authorization = req.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return verify(
    authorization.slice(7),
    env.AUTH_SECRET
  );
}

async function handleAI(task, body, env) {
  if (!env.OPENAI_API_KEY) {
    return json({
      error: "OPENAI_API_KEY secret is not configured."
    }, 503);
  }

  let prompt = "";

  if (task === "chat") {
    prompt = `
You are NUTRIX, a careful and practical nutrition assistant.

Instructions:
- Reply in the user's language.
- Be supportive, clear and budget-conscious.
- Understand foods commonly available in Bangladesh.
- Never diagnose diseases or prescribe medical treatment.
- Do not invent nutrient values.
- Explain when nutrition estimates are uncertain.
- Avoid extreme diets and supplement megadoses.

User nutrition data:
${JSON.stringify(body.summary || {})}

User preferences and memories:
${JSON.stringify(body.memories || [])}

Recent conversation:
${JSON.stringify((body.history || []).slice(-8))}

Current question:
${String(body.message || "").slice(0, 4000)}
`;
  }

  else if (task === "plan") {
    const days = Math.min(
      7,
      Math.max(1, Number(body.days) || 1)
    );

    const budget = Math.max(
      0,
      Number(body.budget) || 0
    );

    prompt = `
Create a practical ${days}-day meal plan for Bangladesh.

Daily budget: ৳${budget}

Nutrition goals:
${JSON.stringify(body.goals || {})}

Food preferences:
${JSON.stringify(body.preferences || [])}

Available foods:
${JSON.stringify(body.foods || [])}

Requirements:
- Give meal-by-meal food portions.
- Estimate calories and protein.
- Suggest low-cost food alternatives.
- Give approximate daily cost.
- Respect the stated budget.
- Do not double count mess meal allocation.
- Clearly label all nutrition estimates as approximate.
- Do not promise exact nutrition values.
- Reply in Bengali when appropriate.
`;
  }

  else {
    return json({
      error: "Unknown AI task."
    }, 404);
  }

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-6-luna",
        input: prompt,
        max_output_tokens: 1100
      })
    }
  );

  const result = await response.json();

  if (!response.ok) {
    return json({
      error:
        result.error?.message ||
        "OpenAI request failed."
    }, 502);
  }

  const reply = (result.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text)
    .join("\n")
    .trim();

  if (task === "plan") {
    return json({
      plan: reply || "No meal plan returned."
    });
  }

  return json({
    reply: reply || "No text response returned."
  });
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: cors
      });
    }

    const url = new URL(req.url);

    try {
      if (!env.AUTH_SECRET) {
        return json({
          error: "AUTH_SECRET is not configured."
        }, 500);
      }

      if (
        url.pathname !== "/api/health" &&
        !env.DB
      ) {
        return json({
          error: "D1 database binding DB is missing."
        }, 500);
      }

      if (
        url.pathname === "/api/health" &&
        req.method === "GET"
      ) {
        return json({
          ok: true,
          service: "NUTRIX API",
          version: "1.0.0"
        });
      }

      // REGISTER

      if (
        url.pathname === "/api/auth/register" &&
        req.method === "POST"
      ) {
        const { username, password } = await req.json();

        if (
          !/^[a-zA-Z0-9_]{3,24}$/.test(username || "") ||
          typeof password !== "string" ||
          password.length < 8 ||
          password.length > 128
        ) {
          return json({
            error: "Username must be 3-24 characters and password must be 8-128 characters."
          }, 400);
        }

        const normalizedUsername = username.toLowerCase();

        const exists = await env.DB.prepare(
          "SELECT id FROM users WHERE username = ?"
        )
          .bind(normalizedUsername)
          .first();

        if (exists) {
          return json({
            error: "Username already exists."
          }, 409);
        }

        const id = crypto.randomUUID();

        const salt = b64(
          crypto.getRandomValues(new Uint8Array(16))
        );

        const passwordHash = await hashPassword(
          password,
          salt
        );

        await env.DB.prepare(
          `INSERT INTO users
          (id, username, password_salt, password_hash, created_at)
          VALUES (?, ?, ?, ?, ?)`
        )
          .bind(
            id,
            normalizedUsername,
            salt,
            passwordHash,
            new Date().toISOString()
          )
          .run();

        const token = await sign({
          sub: id,
          exp: Math.floor(Date.now() / 1000) + 2592000
        }, env.AUTH_SECRET);

        return json({
          token,
          username: normalizedUsername
        });
      }

      // LOGIN

      if (
        url.pathname === "/api/auth/login" &&
        req.method === "POST"
      ) {
        const { username, password } = await req.json();

        if (
          typeof username !== "string" ||
          typeof password !== "string"
        ) {
          return json({
            error: "Username and password are required."
          }, 400);
        }

        const row = await env.DB.prepare(
          "SELECT * FROM users WHERE username = ?"
        )
          .bind(username.toLowerCase())
          .first();

        if (
          !row ||
          await hashPassword(password, row.password_salt) !== row.password_hash
        ) {
          return json({
            error: "Invalid username or password."
          }, 401);
        }

        const token = await sign({
          sub: row.id,
          exp: Math.floor(Date.now() / 1000) + 2592000
        }, env.AUTH_SECRET);

        return json({
          token,
          username: row.username
        });
      }

      // AUTHENTICATION

      const claims = await getUser(req, env);

      if (!claims) {
        return json({
          error: "Please log in again."
        }, 401);
      }

      // SAVE USER DATA

      if (
        url.pathname === "/api/sync" &&
        req.method === "POST"
      ) {
        const { data } = await req.json();

        if (
          !data ||
          typeof data !== "object" ||
          JSON.stringify(data).length > 900000
        ) {
          return json({
            error: "Invalid or oversized sync payload."
          }, 400);
        }

        await env.DB.prepare(
          `INSERT INTO user_data
          (user_id, data_json, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id)
          DO UPDATE SET
          data_json = excluded.data_json,
          updated_at = excluded.updated_at`
        )
          .bind(
            claims.sub,
            JSON.stringify(data),
            new Date().toISOString()
          )
          .run();

        return json({
          ok: true
        });
      }

      // GET USER DATA

      if (
        url.pathname === "/api/sync" &&
        req.method === "GET"
      ) {
        const row = await env.DB.prepare(
          "SELECT data_json, updated_at FROM user_data WHERE user_id = ?"
        )
          .bind(claims.sub)
          .first();

        return json({
          data: row ? JSON.parse(row.data_json) : null,
          updatedAt: row?.updated_at || null
        });
      }

      // AI CHAT AND MEAL PLAN

      if (
        url.pathname.startsWith("/api/ai/") &&
        req.method === "POST"
      ) {
        const task = url.pathname.split("/").pop();
        const body = await req.json();

        if (!["chat", "plan"].includes(task)) {
          return json({
            error: "Unknown AI task."
          }, 404);
        }

        return await handleAI(task, body, env);
      }

      return json({
        error: "Not found."
      }, 404);

    } catch (error) {
      return json({
        error: error?.message || "Server error."
      }, 500);
    }
  }
};
