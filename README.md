# Surge Modules Optimized

Surge 模块与脚本的统一低内存优化仓库。

现有根目录下的 `Spotify.sgmodule` 和 `Spotify.Crack.js` 为兼容旧链接保留，不会移动。后续项目统一存放：

```text
modules/<category>/<slug>.(sgmodule|module|conf|lpx)
scripts/<category>/<slug>/*.js
upstream/<category>/<slug>/
converted/<category>/<slug>/
registry.json
```

## 工作方式

1. 在 GitHub 仓库的 **Actions → Import upstream module → Run workflow** 中填写：
   - `module_url`：上游 `.sgmodule`、`.module`、`.conf`、`.lpx` 或 `.snippet` Raw 链接
   - `slug`：项目短名称，例如 `tieba`
   - `category`：分类，例如 `ad`
2. 工作流拉取模块及其中的远程 JavaScript，保存一份不可混淆的上游快照。
3. 如果来源不是 Surge 模块，先使用 Script Hub 转换为 Surge，并把未经优化的转换结果保存到 `converted/`。
4. 首次导入时生成发布副本，并把模块中的 `script-path` 改为本仓库 Raw 链接。
5. 在 `modules/` 和 `scripts/` 中完成经过验证的性能优化；`upstream/` 与 `converted/` 永远保留对照版本。
6. `Sync upstream snapshots` 工作流每天检查所有登记项目的上游模块及远程脚本，只更新原格式快照，不覆盖转换后的优化版本。
7. 检测到变化后，为每个发生变化的登记项目分别创建或更新带有 `upstream-update` 标签的 Issue，记录差异并标记为等待重新转换、审核和优化。

自动化负责导入、链接改写、上游同步、语法检查和提交。涉及业务字段、Protobuf 或异常策略的性能优化必须经过代码审核和功能测试，不能用自动压缩替代。

## 去广告合集

`modules/ad/ad-combined.sgmodule` 合并了 12306、高德地图、滴滴出行和闲鱼去广告，不包含 Spotify 与网易云。原有单独模块全部保留，但使用合集时不要同时启用对应单独版，以免同一请求被重复处理。

合集由各单独版自动生成。修改任一来源后运行：

```bash
npm run build:combined
```

`npm test` 会检查合集是否与单独版一致、脚本名称是否冲突，以及 MITM 域名是否完整。

## 本地使用

```bash
npm run import -- \
  --url https://raw.githubusercontent.com/owner/repo/refs/heads/main/example.sgmodule \
  --slug example \
  --category ad

npm test
```

如确实需要用上游内容重置发布副本，可额外传入 `--overwrite-optimized`。该选项默认关闭，日常同步不会覆盖优化成果。
