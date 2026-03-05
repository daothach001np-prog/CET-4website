# CET-4 远距共学台（MVP）

这是一个双角色网页：
- 学生：每日提交学习内容（支持文字 + 图片）。
- 老师：批改、评分、写评语（学生端可见）。
- 双方：留言互动。

## 文件结构

```text
.
├─ supabase/
│  └─ schema.sql
├─ web/
│  ├─ index.html
│  ├─ styles.css
│  ├─ app.js
│  ├─ config.js
│  └─ config.example.js
├─ start_web.ps1
└─ start_web.bat
```

## 第一步：执行数据库脚本

在 Supabase `SQL Editor` 里执行 [schema.sql](D:\codex\英语进步网站\supabase\schema.sql) 全部内容。

说明：
- 如果你之前跑过旧版 SQL，也可以直接再跑一次新版 `schema.sql`。
- 这次会新增：
  - 角色函数：`claim_teacher_role()`、`set_user_role(...)`
  - 图片字段：`submissions.image_urls`
  - 图片存储桶：`submission-images`

## 第二步：填 Supabase 配置

编辑 [config.js](D:\codex\英语进步网站\web\config.js)：

```js
window.SUPABASE_URL = "https://YOUR_PROJECT_ID.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_xxx";
```

`SUPABASE_ANON_KEY` 使用 `Publishable key`，不要用 `Secret key`。

## 第三步：启动网页

推荐双击 [start_web.bat](D:\codex\英语进步网站\start_web.bat)

或 PowerShell 运行：

```powershell
cd D:\codex\英语进步网站
powershell -ExecutionPolicy Bypass -File .\start_web.ps1
```

浏览器打开：

```text
http://127.0.0.1:5173
```

## 角色怎么设置

1. 先注册两个邮箱账号并登录。
2. 第一个登录的人（且系统里还没有老师）会看到按钮：`设为老师`。
3. 点 `设为老师` 后，你就是老师。
4. 老师面板里有 `角色管理`，可把另一个账号设置为学生。

## 图片提交和评语可见性

- 学生提交支持多图上传（jpg/png/webp/gif）。
- 老师批改时可以看到学生图片。
- 老师评语写在 `批改编辑器` 中，保存后学生端可见。
- 学生端支持删除“待上传图片”和“已上传图片”（删除已上传后，点击提交才会生效）。
- 手机大图会自动压缩后再上传，降低上传失败概率。

## 罚款规则（当前）

- 每天：`reading` + `listening`
- 隔天：`translation`
- 周六额外：`writing` + `mock`
- 漏交罚款：
  - 第一次 10 元
- 第二次及以后 20 元

## 每次迭代更新步骤（不改站点名）

1. 本地改代码（主要在 `web/` 下）。
2. 本地验证（可选）：
   - 双击 `start_web.bat`
   - 打开 `http://127.0.0.1:5173`
3. 发布到现有 Netlify 站点：
   - Netlify -> 进入你当前站点 -> `Deploys`
   - 使用 `Drag and drop`，把 `web` 文件夹拖进去
4. 部署完成后让手机端强制刷新（清缓存后刷新）。
