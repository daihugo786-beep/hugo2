# 縣市首長施政滿意度 AI 助手（公開部署版・免費方案）

這個資料夾裡有兩個部分：
- `index.html`：前端網頁（聊天介面、內嵌資料、圖表繪製）
- `api/ask.js`：後端 API，負責用你的 **Google Gemini API key**（免費、不用綁卡）呼叫 AI（key 只存在這裡，不會出現在前端）

任何人打開這個網站都不需要帳號，AI 呼叫用的是 Google AI Studio 的免費額度。

---

## 部署步驟（用 Vercel，全程約 10 分鐘）

### 1. 申請 Gemini API key（免費，不用信用卡）
1. 到 https://aistudio.google.com/apikey （用 Google 帳號登入即可，台灣是官方支援地區）
2. 點 **Create API key**，複製起來存好
3. 不需要綁信用卡、不需要開通付費方案

免費額度會依模型而不同，而且 Google 時常調整（我們自己在開發過程中就遇過模型被下架、額度變動的狀況），**這裡不寫死具體數字**，實際額度請到 https://aistudio.google.com/usage 查當前這組 key、這個模型的當日用量與上限。這個工具每次提問會用到 2 次請求（先規劃查詢、再寫摘要）。

### 2. 申請 Vercel 帳號
到 https://vercel.com/signup，建議直接用 GitHub 帳號登入（之後部署比較方便）。

### 3. 上傳這個專案到 GitHub
1. 到 https://github.com/new 建一個新的 repository（public 或 private 都可以）
2. 把這個資料夾裡的所有檔案（`index.html`、`api/ask.js`、`package.json`、`README.md`）上傳上去
   - 最簡單的方式：在 GitHub 網頁上點「uploading an existing file」，把檔案拖進去
   - 注意要保留資料夾結構：`api/ask.js` 要在 `api` 這個資料夾底下

### 4. 在 Vercel 匯入這個 repository
1. 登入 Vercel 後點 **Add New → Project**
2. 選擇你剛剛建立的 GitHub repository，點 **Import**
3. Framework Preset 選 **Other**（純 HTML 專案，不是 React/Next.js）
4. 不用改 Build Command / Output Directory，直接下一步

### 5. 設定環境變數
在匯入設定畫面（或之後到 Project → Settings → Environment Variables）新增：

| 名稱 | 值 |
|---|---|
| `GEMINI_API_KEY` | 你在步驟1拿到的 key |
| `GEMINI_MODEL` | （選填）預設 `gemini-3.6-flash`，與 `api/ask.js` 程式碼裡的預設值一致。若這個模型之後又被 Google 下架或額度不夠用，可以到 aistudio.google.com 查目前可用的模型名稱後改這個變數，不用改程式碼。程式也內建了備援機制：主要模型忙線時會自動改試 `GEMINI_MODEL_FALLBACK`（預設 `gemini-2.5-flash-lite`，同樣可透過環境變數覆蓋） |
| `RATE_LIMIT_PER_MIN` | （選填）預設每個 IP 每分鐘最多 20 次請求 |

### 6. 部署
點 **Deploy**，等約1分鐘，Vercel 會給你一個網址，像 `https://你的專案名稱.vercel.app`，可以直接分享出去。

---

## 之後要更新資料或改網頁

- 改 `index.html`：改完推到 GitHub，Vercel 會自動重新部署
- 換模型或調整速率限制：到 Vercel 專案的 Environment Variables 改，改完要重新部署（Deployments 頁面點 Redeploy）一次才會生效

---

## 免費額度用完了怎麼辦

Gemini 免費額度是「每天重置」的（美國太平洋時間午夜重置），用完當天配額後，網頁會顯示「免費額度暫時用完了」的提示，隔天就會恢復，不會產生任何費用、也不會突然開始扣錢。

如果流量真的大到常常額度不夠：
1. 可以到 Google AI Studio 把專案升級成付費方案（會有真正的費用，但比 Anthropic/OpenAI 通常便宜）
2. 或申請第二組 Gemini key 做備援輪替
3. 或改用 Groq（另一個提供免費額度的平台，跑開源模型，速度很快），架構完全一樣，只是 `api/ask.js` 裡打的 API 端點要換——需要的話跟我說，我可以幫你另外做一版

## 關於濫用防護

目前內建的速率限制是存在記憶體裡的簡易版本（Vercel 伺服器冷啟動就會重置），只能擋掉粗暴濫用。因為現在用的是免費額度，最壞情況就是額度提早用完、隔天恢復，不會有意外扣款風險，所以這個版本可以先不用太擔心防護，等真的常常額度不夠用再考慮加強。

## 資料範圍

內建 2003–2026 年、現制 22 縣市的施政滿意度資料，共 552 筆。2010 年以前，台中、台南、高雄是縣市分治（各年有「原市」「原縣」兩筆獨立資料），2011 年起才合併為一筆；網頁的圖表與排名會把這兩筆分開呈現、標示清楚，不會混在同一個名稱下。完整的資料口徑說明（計分方式變動、縣市合併細節等）已內建在網頁裡的展開區塊。
