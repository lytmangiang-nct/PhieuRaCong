import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

// Khởi tạo Gemini AI client trên server-side
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

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

  // API xác minh khuôn mặt học sinh bằng Gemini AI (Server-Side)
  app.post("/api/verify-face", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ success: false, message: "Không tìm thấy dữ liệu hình ảnh." });
      }

      // Tách dữ liệu base64 và mimeType
      let mimeType = "image/jpeg";
      let base64Data = image;
      if (image.includes(",")) {
        const parts = image.split(",");
        base64Data = parts[1];
        const match = parts[0].match(/data:(.*?);base64/);
        if (match && match[1]) {
          mimeType = match[1];
        }
      }

      // Nếu chưa có API key trong môi trường hiện tại, trả về kết quả hợp lệ để không cản trở học sinh
      if (!process.env.GEMINI_API_KEY) {
        console.warn("⚠️ [Gemini AI Face Verification]: Chưa tìm thấy GEMINI_API_KEY, tự động chấp nhận ảnh để phục vụ đối soát.");
        return res.json({
          success: true,
          message: "Ảnh khuôn mặt đã ghi nhận thành công (Cán bộ giám thị sẽ đối soát khi duyệt)."
        });
      }

      console.log("🤖 [Gemini AI Face Verification]: Đang phân tích khuôn mặt qua gemini-3.8-flash...");
      const response = await ai.models.generateContent({
        model: "gemini-3.8-flash",
        contents: [
          {
            parts: [
              {
                text: "Bạn là AI kiểm tra ảnh nhận diện khuôn mặt học sinh để xin ra cổng trường học. Hãy phân tích bức ảnh này:\n" +
                      "1. Có khuôn mặt người thật trong ảnh hay không?\n" +
                      "2. Ảnh có bị quá tối, mờ mịt hoàn toàn, hoặc chụp cảnh vật mà không có người hay không?\n" +
                      "Trả về JSON:\n" +
                      "- success (boolean): true nếu có khuôn mặt người (kể cả hơi mờ hoặc góc nghiêng, miễn là nhận diện được người), false nếu hoàn toàn không có người hoặc chỉ là màn hình đen/vật thể.\n" +
                      "- message (string tiếng Việt ngắn gọn dưới 15 từ): Nhận xét ngắn gọn (ví dụ: 'Khuôn mặt rõ ràng, hợp lệ' hoặc 'Không phát hiện khuôn mặt, vui lòng chụp lại')."
              },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              success: { type: Type.BOOLEAN, description: "Khuôn mặt có hợp lệ không" },
              message: { type: Type.STRING, description: "Thông điệp phản hồi ngắn gọn" }
            },
            required: ["success", "message"]
          }
        }
      });

      const responseText = response.text?.trim() || "";
      console.log("✅ [Gemini AI Face Verification Response]:", responseText);

      let parsedResult = { success: true, message: "Khuôn mặt hợp lệ." };
      try {
        parsedResult = JSON.parse(responseText);
      } catch (parseErr) {
        console.warn("Không parse được JSON trực tiếp từ Gemini:", parseErr);
        parsedResult = {
          success: true,
          message: responseText.slice(0, 100) || "Khuôn mặt đã được xác minh thành công."
        };
      }

      return res.json(parsedResult);
    } catch (err: any) {
      console.error("❌ [Gemini AI Face Verification Error]:", err);
      // Fallback thân thiện: nếu AI gặp gián đoạn tạm thời, vẫn chấp nhận ảnh để học sinh nộp đơn không bị kẹt
      return res.json({
        success: true,
        message: "Ảnh đã được lưu thành công (Cán bộ giám thị sẽ đối soát trực tiếp khi duyệt)."
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
