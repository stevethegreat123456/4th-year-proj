import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Server } from "socket.io";
import { createServer } from "http";
import cors from "cors";
import dotenv from "dotenv";
import { startBotEngine, initBot } from "./src/server/botEngine.ts";
import { initSupabase } from "./src/server/supabase.ts";
import { analyzeBacktestWithGemini } from "./src/server/geminiAnalyst.ts";

dotenv.config();

async function startServer() {
  initSupabase();
  await initBot();
  
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/ping", (req, res) => {
    res.send("Bot is running!");
  });

  // Server-side Gemini AI backtest risk & market selection endpoint
  app.post("/api/backtest/ai-analyze", async (req, res) => {
    const { config, results } = req.body || {};
    if (!config || !Array.isArray(results) || results.length === 0) {
      return res.status(400).json({ error: "Missing backtest config or market results." });
    }

    try {
      const analysis = await analyzeBacktestWithGemini({ config, results });
      return res.json({ analysis });
    } catch (err: any) {
      console.error("Backtest AI analysis error:", err);
      const status = err?.statusCode || err?.status || 500;
      const message =
        status === 400 || status === 403
          ? "Gemini API authentication failed. Please verify GEMINI_API_KEY in Settings > Secrets."
          : status === 429
            ? "Gemini API quota exceeded. Please retry shortly or check your billing tier in Settings > Secrets."
            : err?.message || "Failed to generate AI backtest analysis.";
      return res.status(status).json({ error: message });
    }
  });

  // Deriv OAuth 2.0 PKCE token exchange endpoint
  app.post("/api/deriv/oauth/token", async (req, res) => {
    const { code, code_verifier, client_id, redirect_uri } = req.body;
    if (!code || !code_verifier || !client_id) {
      return res.status(400).json({ error: "Missing required parameters (code, code_verifier, client_id)" });
    }

    try {
      const formParams = new URLSearchParams();
      formParams.append("grant_type", "authorization_code");
      formParams.append("client_id", String(client_id));
      formParams.append("code", String(code));
      formParams.append("code_verifier", String(code_verifier));
      if (redirect_uri) {
        formParams.append("redirect_uri", String(redirect_uri));
      }

      const tokenRes = await fetch("https://auth.deriv.com/oauth2/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: formParams.toString()
      });

      const data = await tokenRes.json();
      return res.status(tokenRes.status).json(data);
    } catch (err: any) {
      console.error("Deriv OAuth token exchange error:", err);
      return res.status(500).json({ error: err.message || "Failed to exchange token with Deriv" });
    }
  });

  // Start the underlying engine with socket.io
  startBotEngine(io);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      const url = req.originalUrl;
      try {
        const fs = await import('fs');
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
