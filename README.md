# Surge Modules Optimized

Surge 模块与脚本的统一低内存优化仓库。

现有根目录下的 `Spotify.sgmodule` 和 `Spotify.Crack.js` 为兼容旧链接保留，不会移动。后续项目统一存放：

```text
modules/<category>/<slug>.(sgmodule|module|conf|lpx)
scripts/<category>/<slug>/*.js
upstream/<category>/<slug>/
registry.json
```

## 工作方式

1. 在 GitHub 仓库的 **Actions → Import upstream module → Run workflow** 中填写：
   - `module_url`：上游 `.sgmodule`、`.module`、`.conf` 或 `.lpx` Raw 链接
   - `slug`：项目短名称，例如 `tieba`
   - `category`：分类，例如 `ad`
2. 工作流拉取模块及其中的远程 JavaScript，保存一份不可混淆的上游快照。
3. 首次导入时生成发布副本，并把模块中的 `script-path` 改为本仓库 Raw 链接。
4. 在 `modules/` 和 `scripts/` 中完成经过验证的性能优化；`upstream/` 永远保留对照版本。
5. `Sync upstream snapshots` 工作流每天检查上游变化，只更新快照，不覆盖优化版本。

自动化负责导入、链接改写、上游同步、语法检查和提交。涉及业务字段、Protobuf 或异常策略的性能优化必须经过代码审核和功能测试，不能用自动压缩替代。

## 本地使用

```bash
npm run import -- \
  --url https://raw.githubusercontent.com/owner/repo/refs/heads/main/example.sgmodule \
  --slug example \
  --category ad

npm test
```

如确实需要用上游内容重置发布副本，可额外传入 `--overwrite-optimized`。该选项默认关闭，日常同步不会覆盖优化成果。
