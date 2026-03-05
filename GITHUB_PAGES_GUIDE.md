# GitHub Pages 发布指南（本项目）

本项目已经配置为：你只要把代码 `push` 到 `main`，GitHub Pages 会自动重新部署 `web/` 目录。

## 1. 先做一次仓库初始化（只需一次）

```powershell
cd D:\codex\英语进步网站
git init
git add .
git commit -m "init: prepare github pages deploy"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
git push -u origin main
```

如果你已经 `git init` 过，只需要补 `remote` 和 `push`。

## 2. 在 GitHub 打开 Pages

1. 打开仓库 -> `Settings` -> `Pages`
2. `Source` 选择 `GitHub Actions`
3. 回到仓库 `Actions` 页面，等待 `Deploy Web To GitHub Pages` 完成

完成后访问地址：

- 项目仓库页：`https://<用户名>.github.io/<仓库名>/`
- 如果仓库名本身是 `<用户名>.github.io`：就是根域名地址

## 3. 以后更新流程（你最关心的）

每次改完网站，只要：

```powershell
cd D:\codex\英语进步网站
git add .
git commit -m "feat: update web"
git push
```

然后 GitHub 会自动部署。你不需要再手动拖拽到 Netlify。

## 4. 关于 `config.js`

`web/config.js` 是前端运行必需文件，GitHub Pages 也会读取它。

- 这里要放 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`
- 必须使用 `anon/publishable key`，不要放 `service_role` 密钥

## 5. 关于“免费与限制”

GitHub Pages 对静态站点通常够用，而且不会像你现在体验的那样每次手动发布受限。
但它不是“无限资源”，仍有平台配额与使用政策（例如构建频率、带宽、仓库/站点大小等）。
对这个英语学习站点规模，正常使用完全足够。
