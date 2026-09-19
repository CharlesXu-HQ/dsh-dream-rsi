# 发布与发现清单（2026-09-19）

这个项目是非官方的 Dream-RSI 思路实现，不代表 DeepSeek 或 Dream-RSI 论文作者。现在已具备 DeepSeek Harness 的 bundle 包格式。2026-09-19 用隔离的 `DSH_HOME` 对 `@deepseek-ai/dsh@0.1.6-alpha.2` 完成了本地目录及 tarball 安装、`--dump-config` 和 Web 启动 smoke test；tarball 安装无 peer dependency 问题。**尚未在真实模型会话中调用工具，也尚未发布到 npm**。

## 发布前

1. 本项目采用 MIT；继续分发前核对 `LICENSE` 中的版权署名、实际权利人及所有素材/代码的再发布权限。确认种子任务、评测脚本与示例数据都可公开。不要把运行状态目录、模型凭据或受限数据提交进仓库。
2. 在带模型凭据的真实 DSH Web 会话中，用示例任务实际调用一次 `dream_rsi_cycle`。本地目录和 tarball 的 profile 安装、配置合并与 Web 启动 smoke test 已在 `@deepseek-ai/dsh@0.1.6-alpha.2` 完成；发布前仍须记录完整会话结果和截图。
3. 运行 `npm test`、`npm run check`、`npm run build`、`npm pack --dry-run --json`。发布包应包含 `lib/plugin.js`、`lib/core.js` 和 `cordis.patch.yml`。固定一个兼容的 DSH 版本范围；开发者预览期接口会变化。
4. README 首页保留一句准确定位：**replay-based exploration-policy experiment, not a full reproduction of Dream-RSI**。提供 60 秒玩具任务演示、安装/卸载命令，以及与论文差异和安全边界。已有测试只能证明本地语义，不能替代真实任务或 holdout 结果。

## 让 Harness 用户找到它

1. 公开 GitHub 仓库后添加 `dsh-plugin` topic。DeepSeek Harness [官方首页](https://deepseek.com/harness/en/)的「Community plugins」直接指向这个 [GitHub topic](https://github.com/topics/dsh-plugin)；[官方仓库 README](https://github.com/deepseek-ai/deepseek-harness)也明确建议这样做。**这不是 DeepSeek 官方审核或收录承诺。**
2. 提供可安装版本：优先发布预编译 npm 包 `dsh-dream-rsi`，用户可运行 `dsh plugin --profile web add dsh-dream-rsi`；也可先提供 `npm pack` 生成的 tarball。直接从 GitHub 安装时，TypeScript 源码需要 `prepare` 构建，pnpm ≥10 还要求用户明确允许依赖的构建脚本。参见 [官方打包教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)。不要在没有实际发布前展示 npm 安装命令为“现已可用”。
3. 真实集成验证后，在上游的 [Show Your Plugins 讨论区](https://github.com/deepseek-ai/deepseek-harness/discussions/categories/show-your-plugins)发一个项目帖。[该区规则](https://github.com/deepseek-ai/deepseek-harness/discussions/2004)要求：每项目一个主题；标题为 `DSH | Project Name | One-line description`；附项目 URL、简述、截图、与 DSH 的集成方式；显著标注非官方。Upvote 不是官方背书。
4. 再考虑向社区维护的插件列表提交 PR。先核对各列表的安装验证与分类要求；不要把第三方目录写成 DeepSeek 官方市场。公开基线对照与负结果，比只给 star 链接更能建立可信度。

## 可用的上游讨论帖草稿

标题：`DSH | dsh-dream-rsi | Replay-based exploration policy experiments`

> Unofficial community plugin, independently developed and maintained. Repository: **https://github.com/CharlesXu-HQ/dsh-dream-rsi**. `dsh-dream-rsi` is a Cordis bundle for DeepSeek Harness. It registers `dream_rsi_cycle`, uses Harness agents for candidate generation and policy revision, and evaluates policy candidates on frozen discovery trees without rerunning the coding agent. Install with **[待填已验证命令]**. The current policy language is a restricted linear rule family; this is not a full reproduction of the Dream-RSI paper. Tested with **[待填真实 Harness 版本与可复现实验链接]**. Demo/screenshot: **[待填]**.

这份草稿只是发布材料，不会自动向 GitHub、npm 或其他人发送内容。
