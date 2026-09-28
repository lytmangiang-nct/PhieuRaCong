import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware giải mã JSON body
  app.use(express.json({ limit: '10mb' }));

  // Middleware CORS để hỗ trợ mọi môi trường trình duyệt và iframe
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // API proxy để chuyển tiếp Webhook (Make AI, Custom Webhook) tránh hoàn toàn lỗi CORS ở trình duyệt
  app.post("/api/webhook", async (req, res) => {
    const { webhookUrl, payload } = req.body;
    
    if (!webhookUrl || typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
      console.warn("⚠️ [PROXY Webhook] Nhận yêu cầu không có webhookUrl hợp lệ:", webhookUrl);
      return res.status(400).json({ error: "Địa chỉ Webhook URL không hợp lệ (phải bắt đầu bằng http:// hoặc https://)." });
    }

    try {
      console.log(`🚀 [PROXY Webhook] Đang chuyển tiếp dữ liệu đến: ${webhookUrl}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 giây timeout

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        body: JSON.stringify(payload),
        redirect: "follow",
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      console.log(`✅ [PROXY Webhook] Phản hồi từ ${webhookUrl} (Status: ${response.status}):`, responseText.slice(0, 200));
      
      res.status(response.status);
      try {
        const json = JSON.parse(responseText);
        res.json(json);
      } catch {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send(responseText || "Accepted");
      }
    } catch (error: any) {
      console.error(`❌ [PROXY Webhook] Lỗi khi kết nối hoặc gửi tới ${webhookUrl}:`, error);
      const isTimeout = error.name === 'AbortError';
      res.status(isTimeout ? 504 : 502).json({ 
        error: isTimeout 
          ? "Hết thời gian chờ phản hồi từ máy chủ Webhook (Timeout 12s)."
          : "Không thể kết nối đến Webhook Make. Vui lòng kiểm tra lại URL.",
        details: error?.message || String(error)
      });
    }
  });

  // API kiểm tra trạng thái hoạt động của server
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", message: "Server proxy đang chạy khoẻ mạnh!" });
  });

  // Tích hợp Vite làm middleware khi chạy trên môi trường phát triển (Development)
  if (process.env.NODE_ENV !== "production") {
    console.log("⚙️  Chạy ở chế độ DEVELOPMENT - Khởi tạo Vite Middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Chạy ở môi trường PRODUCTON - Phục vụ file tĩnh đã biên dịch trong thư mục dist
    console.log("📦 Chạy ở chế độ PRODUCTION - Đang phục vụ các thư mục tĩnh...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Hệ thống Gateway khởi chạy thành công tại http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("❌ Không thể khởi động server trung gian:", error);
});
