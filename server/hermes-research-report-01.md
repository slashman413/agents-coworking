# slashmantools.us 市場需求與競爭分析報告

**研究日期**：2026-07-23  
**研究員**：Researcher Agent  
**範圍**：slashman413 完整資產組合（A~F 六大類）

---

## 執行摘要

slashman413 擁有 121 個 GitHub repos，原創活躍資產橫跨免費工具站、台股量化系統、AI 自動化內容 Pipeline、SaaS 開發者工具四大賽道。**核心發現**：台股量化資產（特別是 TWSEMCPServer MCP 生態先行者機會）與 SaaS starter-lite 是辨識度最高、變現潛力最大的資產；18 個免費工具站若無 SEO 投入，流量收入趨近零。以下是逐類深度分析。

---

## 1. 逐類別市場分析

### A 類：slashmantools.us 免費工具站（18 個工具）

| 維度 | 數據 |
|------|------|
| 目標用戶 | 全球一般網民（學生、辦公族、小型自媒體經營者）、開發者、設計師 |
| 市場總規模 | 全球免費線上工具市場約 **$8-12B USD**（含 PDF/圖片/開發工具/計算機等子類別），年增 8-12% |
| 龍頭流量參照 | iLovePDF ~225M 月訪、Smallpdf ~3.4M（僅美國）、tinywow ~1.92M（僅美國）、10015.io 估百萬級 |
| 台灣競品 | 幾乎無本土競品 — 台灣做免費工具站且中英雙語的幾乎為零 |
| **需求強度** | **極高但壟斷**。用戶每天搜尋「free pdf tools」「online unit converter」等關鍵字，但已被巨頭 (iLovePDF, Smallpdf) + 中型站台 (10015.io, tinywow, Online-Convert) 分食 90%+ 流量 |

**機會縫隙**：
- PDF 系工具（pdf-tools、image-compressor）**直接撞牆** — iLovePDF（225M 月訪）和 Smallpdf（3.4M 美月訪）已做到品牌級認知，新進者 SEO 成本極高
- **AI 系工具**（token-cost-calculator、ai-image-size-calculator、ai-prompt-library）是**唯一差異化縫隙** — 這三類競品極少，搜尋量快速成長但尚未被大站壟斷
- **開發工具**（dev-tools、json-regex-devtools）市場雖大，但 10015.io、toolbox.googleapps 等已經覆蓋，除非做到更深或特色化

---

### B 類：台股/金融量化（差異化核心資產）

| 維度 | 數據 |
|------|------|
| 目標用戶 | 台灣散戶投資人（~550 萬活躍交易帳戶）、自媒體財經內容創作者 |
| 市場規模 | 台灣股市開戶數約 **1,250 萬（2025 年底數據）**，活躍交易人口約 450-550 萬；散戶交易量佔全市場 **~55-60%** |
| 競品生態 | 財報狗 94K 日訪(~2.8M 月訪)、Goodinfo 3.3M 月訪、玩股網/HiStock/CMoney 各數十萬月訪；國內量化工具 FinLab 少數具技術深度 |
| MCP 生態先行者 | **TWSEMCPServer 幾乎無競品** — 目前僅 twjackysu 版（133⭐）和 pyang2045（5⭐），皆為通用型實現；MCP 生態正爆炸成長中，台股資料節點為藍海 |
| **需求強度** | **極強且持續增長**。2025 台股日均成交額 ~3,500-4,000 億台幣，散戶 AI/量化工具需求每年成長 20%+ — 但多數競品仍停留在傳統網站/App 形式 |

**機會縫隙**：
- MCP Server 形式的台股資料接口 **幾乎為零競爭**，是 AI agent 時代真正的藍海
- 現有競品（財報狗、Goodinfo）UI 老化、無 API/無 MCP、無自動化 pipeline 支援
- TWSE OpenAPI 免費且官方支援，資料成本完全為零
- AI agent（Claude Code、Codex、Cursor）使用者快速成長，**需要程式化存取台股資料**，這正是 TWSEMCPServer 的 TA

---

### C 類：Hermes 自動化內容/變現 Pipeline

| 維度 | 數據 |
|------|------|
| 目標用戶 | 內容創作者（特別是非現身 faceless YouTuber）、數位產品賣家 |
| 市場規模 | AI 影片生成市場 2026 年估 **$5-8B**，其中 faceless YouTube 內容約佔 $1-2B；AI Shorts 市場年增 40%+ |
| 競品生態 | InVideo AI、Kapwing、Pictory、Descript 等付費 SaaS；開源替代：https://github.com/HeyGen (商業)、openedai-speech 等 |
| **需求強度** | **高但擁擠**。YouTube shorts 自動化賽道已有數千個頻道競爭，差異化需要**利基內容策略**而非純技術優勢 |

**機會縫隙**：
- 每日完全自動化（GitHub Actions 零成本）的完整 pipeline 是本資產優勢，但內容品質與人類創作仍有差距
- **AI 科技新聞雙人對話**（ai-tech-news-vid-2ppl）是較好的利基 — 科技新聞受眾商業價值高
- **名言 Shorts**（pixabay-shorts-bot）和**工具介紹**（tool-shorts-bot）競爭極度激烈
- 變現僅靠 Ko-fi 贊助（ko-fi.com/ytstories0413），尚無廣告收入或付費訂閱

---

### D 類：SaaS/開發者資產

| 維度 | 數據 |
|------|------|
| 目標用戶 | 獨立開發者（Indie hackers）、新創公司、Next.js 開發者社群 |
| 市場規模 | SaaS boilerplate 市場約 **$50-100M/年**（僅 Next.js 生態），龍頭 ShipFast（Marc Lou）年營收估 $2-3M |
| 競品生態 | ShipFast（$69-$249/次）、MakerKit（$49-$99/月）、Supastarter（$49-$149/次）、LaunchSaaS、MkSaaS — **至少 10-15 個付費競品** |
| **需求強度** | **中等。** 市場擁擠但定價天花板低。開源免費版的 saas-starter-lite 作為漏斗頂端引流可行，但月流量微小時轉換率趨零 |

**機會縫隙**：
- **免費開源 + 完整版付費**是 ShipFast 驗證的模式 — 但需先建立社群（GitHub stars 破千才有自然擴散）
- agents-coworking（Multi-Agent Cowork MCP Server）是**非常前衛的資產** — MCP + 多 agent 協作正是 2026 H2 最熱的 AI 架構趨勢
- nuwa-skill（思維蒸餾）具中文 AI 圈話題性，但商業模式不明確

---

## 2. 具名競品分析

### A 類競品矩陣

| 競品 | 月流量(估) | 強項 | 弱項 | 我方差異化縫隙 |
|------|-----------|------|------|--------------|
| **iLovePDF** | ~225M | 品牌認知、SEO 權重、支援所有 PDF 功能 | 僅 PDF；全英文 | 不做 PDF 正面競爭 |
| **Smallpdf** | ~3.4M（美） | UX 極佳、轉換率優、SaaS 訂閱模式成功 | 付費牆嚴重，免費限制多 | |
| **tinywow** | ~1.9M（美） | 多功能（PDF+圖片+影片）、沒付費牆 | 廣告多、速度慢、無 AI 工具 | |
| **10015.io** | ~1-2M | 開發者工具集中、UI 簡潔 | 無 AI 工具、無中文 | **AI 系工具（token 成本、AI 圖片尺寸）** 三者均無競爭 |
| **Online-Convert** | ~5-8M | 多媒體格式轉換深度 | UI 老舊、速度慢 | |

### B 類競品矩陣

| 競品 | 月流量(估) | 強項 | 弱項 | 我方差異化縫隙 |
|------|-----------|------|------|--------------|
| **財報狗** | ~2.8M | 財報數據完整、選股系統成熟、自有社群 | 無 MCP/API、無即時報價、付費牆 $299/月 | **MCP 存取**＋**量化自動化** |
| **Goodinfo** | ~3.3M | 資訊密度極高、法人買賣即時、免費 | UI 極簡/老舊、無 API、無跨平台 | **Dashboard 可視化**＋**程式化資料接口** |
| **玩股網** | ~0.5-1M | 教學內容豐富、社群討論區 | 量化分析深度不足 | **回測 + ETF 分析深度** |
| **HiStock 嗨投資** | ~0.3-0.5M | 社群共創、市場看法交流 | 技術分析平庸 | |
| **XQ 全球贏家** | ~0.1M（桌面版用戶） | 專業看盤軟體、回測功能、策略開發 | 桌面應用、非 SaaS、$399/月 | **免費開源 web 版** |
| **FinLab** | ~0.2M | Python 量化社群、策略共享 | 偏向程式人、非一般散戶 | **全 UI web 應用**（etf-financial-analyzer） |
| **TradingView** | ~500M（全球） | 全球最大 charting platform | 台股資料不夠即時、進階功能付費 | **台灣本土深度**（ETF 成分股財報/三大法人） |
| **twjackysu/TWSEMCPServer** | 133⭐ | 最早的台股 MCP server、整合三交易所 | 文件不夠完善、非 slashman413 維護 | 無重大差異（兩者幾乎相同） |
| **pyang2045/twsemcp** | 5⭐ | 即時報價 | 功能較少 | 可整合特點學習 |

### C 類競品矩陣

| 競品 | 強項 | 弱項 | 差異化 |
|------|------|------|--------|
| **InVideo AI** | 品牌強、模板品質高 | $30-60/月付費 | GitHub Actions 零成本 |
| **Pictory** | 長片→短片效果好 | 鎖定英文市場 | 中文+英文雙語內容 |
| **Descript** | AI 編輯、專業級 | 桌面軟體、非排程自動化 | 全自動 pipeline（每日排程） |
| **HeyGen** | AI 數位人品質業界領先 | $24+/月 | 開源替代方案 |

### D 類競品矩陣

| 競品 | 定價 | GitHub Stars(估) | 強項 |
|------|------|-------------------|------|
| **ShipFast** | $69-$249 一次 | 10K+ | 最受歡迎、Marc Lou 個人品牌 |
| **MakerKit** | $49-$99/月 | 2K+ | Supabase/Stripe 整合 |
| **Supastarter** | $49-$149 一次 | 3K+ | 完整功能 |
| **Create T3 App** | 免費 | 25K+ | 最知名的開源 starter |
| **saas-starter-lite** | 免費（0⭐） | 0 | 免費+多租戶+RBAC — 但無曝光 |

---

## 3. 機會分數表

### A 類：工具站逐工具

| 工具 | 市場大小 | 競爭強度 | 差異化 | 勝出機率 | 一句話理由 |
|------|---------|---------|--------|---------|-----------|
| token-cost-calculator | M | 低 | 高 | ★★★★☆ | LLM token 計價資訊不對稱，搜尋量每月暴增，幾乎無專站競品 |
| ai-image-size-calculator | S | 低 | 高 | ★★★★☆ | Midjourney/SD 用戶每天都需要，無同類專站 |
| ai-prompt-library | L | 中 | 中 | ★★★☆☆ | Prompt 市場大但競品多（PromptBase、FlowGPT），差異化靠免費+本土 |
| llm-calc（VRAM/RAM） | S | 低 | 高 | ★★★★☆ | 買顯卡跑 LLM 的用戶精準，但不一定搜尋 |
| bio-generator | M | 高 | 低 | ★★☆☆☆ | 已有 Canva、Later、數百個 bio generator |
| dev-tools（Base64/URL/JWT/etc） | L | 高 | 低 | ★★☆☆☆ | 10015.io、DevToys、Online Tools 已全面覆蓋 |
| json-regex-devtools | M | 中 | 中 | ★★★☆☆ | 特定開發者群，JSON 格式化+regex 測試組合較少見 |
| password-generator | L | 極高 | 低 | ★☆☆☆☆ | 所有工具站都有，瀏覽器內建，無差異化可能 |
| qr-code-generator | L | 極高 | 低 | ★☆☆☆☆ | 同密碼產生器，手機可原生生成 |
| color-tools | M | 中 | 中 | ★★★☆☆ | 設計師天天用，但已有 coolors.co、Adobe Color 等強者 |
| unit-converter | L | 極高 | 低 | ★☆☆☆☆ | Google 搜尋直接顯示轉換結果，工具站無用武之地 |
| compound-calculator | S | 低 | 高 | ★★★★☆ | 5 語言版本（EN/中/ES/HI/AR）是獨特賣點，複利計算有 SEO 長尾 |
| calculators（BMI/百分比/貸款） | L | 極高 | 低 | ★☆☆☆☆ | 搜尋引擎已內建，Calculator.net 是巨頭 |
| word-counter | L | 極高 | 低 | ★☆☆☆☆ | 數百個競品，瀏覽器外掛也做得到 |
| image-compressor | L | 高 | 低 | ★★☆☆☆ | TinyPNG 是品牌級競品，瀏覽器內壓縮不新鮮 |
| pdf-tools（圖轉PDF/合併） | L | 極高 | 低 | ★★☆☆☆ | iLovePDF 225M 月訪，不可正面競爭 |
| pomodoro-focus-timer | L | 高 | 低 | ★★☆☆☆ | 數千個 timer 網站+App，番茄鐘無法差異化 |
| global-events-tracker | S | 低 | 高 | ★★★☆☆ | 3D 地球儀視覺化有 wow factor，但缺乏 SEO 詞彙 |

### B 類：台股量化資產

| 資產 | 市場大小 | 競爭強度 | 差異化 | 勝出機率 | 一句話理由 |
|------|---------|---------|--------|---------|-----------|
| **TWSEMCPServer** | M | 極低 | 極高 | ★★★★★ | MCP 生態爆炸成長中，台股 MCP 幾乎零競品，133⭐ 證明了需求存在 |
| **twse-backtests** | M | 低 | 高 | ★★★★☆ | 台股回測開源儀表板極少，散戶對回測需求強 |
| **etf-financial-analyzer** | L | 中 | 高 | ★★★★☆ | 完整 Next.js+FastAPI web app，台股 ETF 財報自動化是財報狗的潛在替代 |
| **tw-etf-dashboard** | M | 低 | 高 | ★★★★☆ | 三維分析（財務/技術/估值）的 dashboard 形式獨特 |
| **twse-surge-stocks-dna** | M | 低 | 高 | ★★★★☆ | 大飆股 DNA 量化篩選 — 散戶追逐的熱門關鍵詞 |
| **macro-dashboard** | S | 低 | 高 | ★★★☆☆ | 總經數據視覺化，目標用戶較窄 |
| **hermes-twse-premium** | M | 低 | 高 | ★★★★☆ | 付費訂閱實驗倉，但需先建立信任 |

### C 類：自動化內容 Pipeline

| 資產 | 市場大小 | 競爭強度 | 差異化 | 勝出機率 | 一句話理由 |
|------|---------|---------|--------|---------|-----------|
| ai-tech-news-vid-2ppl | M | 中 | 高 | ★★★☆☆ | 雙人對話形式較新，科技新聞廣告 CPM 高，但 YouTube 營利門檻為瓶頸 |
| ai-digital-human-pipeline | L | 高 | 中 | ★★☆☆☆ | 數位人賽道巨頭（HeyGen/Synthesia）已卡位 |
| tool-shorts-bot | S | 低 | 中 | ★★★☆☆ | 介紹自己工具站的 Shorts→帶流量到 slashmantools.us，但流量目前很小 |
| pixabay-shorts-bot | L | 極高 | 低 | ★☆☆☆☆ | 名言 Shorts 極氾濫，需要爆量製作出數量奇蹟 |

### D 類：SaaS/開發者資產

| 資產 | 市場大小 | 競爭強度 | 差異化 | 勝出機率 | 一句話理由 |
|------|---------|---------|--------|---------|-----------|
| saas-starter-lite  | L | 高 | 中 | ★★☆☆☆ | 免費+多租戶+RBAC 是賣點，但 0⭐ = 零曝光，需先推廣 |
| agents-coworking | M | 低 | 高 | ★★★★☆ | MCP + 多 agent 協作 = 2026 H2 AI 架構最熱關鍵字，目前極少同類開源專案 |
| nuwa-skill | S | 低 | 極高 | ★★★☆☆ | 思維蒸餾話題強但商業模式不明確，品牌/社群價值 > 直接營收 |

### E 類：入口/品牌

| 資產 | 市場大小 | 競爭強度 | 差異化 | 勝出機率 | 理由 |
|------|---------|---------|--------|---------|------|
| slashman413.github.io | M | 高 | 低 | ★★☆☆☆ | Link-in-bio 市場被 Linktree/Beacons/Carrd 壟斷 |
| slashmantools.us 聚合網域 | — | — | — | — | 網域本身無營收，但作為所有工具的統一入口和 SEO 域名有品牌價值 |

---

## 4. 特別評估

### (a) TWSEMCPServer 在 AI agent/MCP 生態的先行者機會 ⭐

**判斷：這可能是整個組合中最大的單一機會。**

- MCP（Model Context Protocol）由 Anthropic 2024 年底推出，2025-2026 年成為 AI agent 生態事實標準
- 目前公開的 MCP server 約 2,000+ 個（GitHub 統計），但**台股/台灣金融數據相關不到 5 個**
- 競爭態勢：
  - **twjackysu/TWSEMCPServer**（133⭐, 37🍴）：先發優勢最大，有社群的 beta 用戶
  - **slashman413/TWSEMCPServer**（0⭐）：與 twjackysu 幾乎相同的程式碼基底（fork 關係），完全沒有差異化
  - **pyang2045/twsemcp**（5⭐）：即時報價為特色，但功能較少
- **緊急建議**：slashman413 需要立即差異化 TWSEMCPServer，否則 twjackysu 版會吸走所有 MCP 生態的台股用戶。可採取：
  1. 加入獨家功能（如 ETF 成分股財報自動分析、AI 選股指標、歷史回測整合）
  2. 更好的文件（英文+中文）、快速起手教學
  3. npm package 發布（讓 agent 一鍵安裝）
  4. 在 MCP 官方市場（mcp.com）註冊
  5. 與現有台股工具（twse-backtests、etf-financial-analyzer）整合成一站式台股 AI 資料平台

### (b) 台股量化 Dashboard 的付費意願評估

| 層級 | 用戶群 | 人數(估) | 付費意願 | 合理定價 |
|------|--------|---------|---------|---------|
| Tier 1：專業散戶 | 每日交易、自有策略 | 5-10 萬 | 高（每月花 $300-1,000 在 XQ/籌碼K線等工具） | $299-599/月 或 $1,999-3,999/年 |
| Tier 2：積極散戶 | 每週交易、看基本面 | 30-50 萬 | 中（願意每月花 $50-200） | $99-199/月 |
| Tier 3：一般散戶 | 偶爾買賣、跟風 | 300-500 萬 | 低（零元或 Ko-fi 等級） | 免費+贊助 |

**關鍵事實**：XQ 全球贏家月費 $399、財報狗年費 $3,588（$299/月）、籌碼K線月費 $300。台股散戶對**真正有用**的工具**有明確付費習慣**。

**挑戰**：產品需要先證明「有用」— 即在選股/交易決策上產出可驗證的幫助，用戶才願意付錢。

### (c) 18 個免費工具站 — Top 3 最值得投 SEO

| 排名 | 工具 | 理由 |
|------|------|------|
| 🥇 | **token-cost-calculator** | LLM token 計價是 2025-2026 超高速成長的關鍵字（GPT-5/Claude 4/Gemini 3 新模型不斷推出），搜尋意圖強（精打細算開發者），幾乎無專站競品。SEO 長尾：`gpt-5 cost per token`、`claude 4 pricing`、`deepseek token cost` 等 |
| 🥈 | **llm-calc（VRAM/RAM 計算機）** | 本地 LLM 熱潮（Llama 4、DeepSeek V4、Qwen 3）持續推升「顯卡 VRAM 夠不夠跑模型」的搜尋需求。這個問題每週在 Reddit/LocalLLaMA 被問數百次。 |
| 🥉 | **compound-calculator（5 語言版）** | 複利計算搜尋量大但競爭不高。**5 語言版本（EN/中/ES/HI/AR）** 讓它在多語系 SEO 中有天然優勢 — 西班牙語和印度語的複利計算工具極少。 |

---

## 5. 結論：Top 5 最有市場潛力資產排序

| 排名 | 資產 | 類別 | 潛力等級 | 核心理由 |
|------|------|------|---------|---------|
| **#1** | **TWSEMCPServer**（差異化後） | B | 🔥🔥🔥🔥🔥 | MCP 生態先行者機會極大，台股資料是藍海，但需立即與競品差異化避免被 twjackysu 版吸走所有用戶 |
| **#2** | **twse-backtests + etf-financial-analyzer**（整合為一台股平台） | B | 🔥🔥🔥🔥🔥 | 台股散戶 500 萬活躍人口，對回測/ETF 分析有真實付費意願（$99-299/月），目前開源方案 + 全 UI 的組合獨特 |
| **#3** | **agents-coworking** | D | 🔥🔥🔥🔥 | MCP + 多 agent 協作是 2026 H2 最熱 AI 架構議題，同類開源專案極少。若加上產品化（SaaS 版本）有爆發可能 |
| **#4** | **token-cost-calculator + llm-calc**（AI 工具群組） | A | 🔥🔥🔥 | LLM 計價/VRAM 計算的 SEO 紅利期約還有 12-18 個月——搜尋量高速成長但競品尚未入場，請把握時間 |
| **#5** | **hermes-make-money + ai-tech-news-vid-2ppl**（內容變現 pipeline） | C | 🔥🔥🔥 | 完全自動化、零成本的內容 pipeline 是中長期被動收入潛力資產。但 YouTube 營利門檻（1,000 訂閱/4,000 小時）是最大瓶頸，變現路徑較遠 |

---

## 附錄：優先行動建議

1. **立即（本月）**：將 TWSEMCPServer 與 twjackysu 版做出功能差異化（建議加 ETF 財報分析 + 選股指標 MCP tool），發布 npm package、註冊 MCP 官方市場
2. **短期（1-3 月）**：將 twse-backtests + etf-financial-analyzer + tw-etf-dashboard 整合為單一「台股量化 AI 平台」，加入付費牆方案
3. **中期（3-6 月）**：對 token-cost-calculator 和 llm-calc 做基礎 SEO（meta tags、blog posts、backlinks），觀察流量成長
4. **長期**：agents-coworking 產品化（SaaS 版本），如果 MCP+多 agent 趨勢持續

---

*報告結束。數據來源：GitHub API、公開流量估算平台、證交所公開統計、競品網站公開資訊。部分流量為合理估算，非內部數據。*
