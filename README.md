# Dream-RSI for DeepSeek Harness（实验版）

这是一个独立的 TypeScript / Cordis 插件，通过 DeepSeek Harness 的 `ctx.agents` 创建固定的 coding agent 和策略修订 agent，通过 `ctx.tools` 暴露 `dream_rsi_cycle`。不依赖 Pi，也不要求 DGX Spark；这里的“独立”仅指不以这两个项目/硬件为运行前提，**仍依赖 DeepSeek Harness**。

每次调用执行一个循环：从种子工作区复制候选 → agent 探索并由固定 evaluator 评分 → 冻结 discovery tree → 对历史全部树做 prefix-only replay → agent 修订策略参数 → 将 replay 平均分最高的策略用于下一轮。当前策略也参与比较，因此在这些已记录历史树上的 replay 分数不会下降；这不是新任务上的性能保证。

## 安装到 Harness

需要 Node.js 22.19+ 和已安装的 [DeepSeek Harness CLI](https://github.com/deepseek-ai/deepseek-harness)。本仓库声明了 `dsh.bundle` 和 `cordis.patch.yml`，可以作为插件包安装到 Web profile：

```sh
git clone https://github.com/CharlesXu-HQ/dsh-dream-rsi.git
cd dsh-dream-rsi
npm install
npm test
dsh plugin --profile web add .
dsh --profile web --dump-config
```

安装后，在自己的任务 patch 文件中配置目标工作区和固定评测器。例如：

```yaml
- id: dream-rsi
  config:
    seedDir: '/ABS/PATH/dsh-dream-rsi/examples/toy/seed'
    stateDir: '/ABS/PATH/dsh-dream-rsi/.dream-rsi-state'
    taskPrompt: 'Edit candidate.json so value approaches 42.'
    evaluatorCommand:
      - node
      - '/ABS/PATH/dsh-dream-rsi/examples/toy/evaluate.mjs'
    provider: deepseek
    model: deepseek-chat
    maxRounds: 5
    replayRounds: 10
    maxWidth: 2
    revisions: 2
    beta1: 0.01
    beta2: 0.01
```

将 `/ABS/PATH` 替换为真实绝对路径，运行 `dsh web --patch /ABS/PATH/my-task.patch.yml`；在会话中要求 agent 调用 `dream_rsi_cycle`。未配置任务时，插件可加载，但调用工具会给出缺少配置的错误。所选 profile 还须提供 coding agent 所需的文件编辑工具和模型凭据。独立安装包发布后，可用 `dsh plugin --profile web add dsh-dream-rsi`；**目前尚未发布到 npm**。

Evaluator 命令在候选工作区下运行，最后一个参数是该工作区绝对路径；必须从 stdout 输出一个 JSON 对象，如 `{"score": 0.8, "feedback": "tests passed"}`。它是固定的、不能被策略 agent 改写。`stateDir/state.json` 保存 world pool 和当前策略；每个 `cycle-*` 目录保存根与子节点工作区。`stateDir` 必须与 `seedDir` 分离且互不包含。

## 核心语义与边界

- 在线策略只得到已生成的节点；合法父节点为根或当前叶子，每轮最多 `maxWidth` 个。工作区从父节点快照复制；同一轮候选并行运行。
- Replay 从仅含根的前缀开始；叶子打开其唯一历史子节点，根打开最早尚未揭示的历史子节点。不调用 coding agent 或 evaluator。得分为 `bestScore - beta1 × N + beta2 × N / max(1, rounds)`。
- 策略修订目前是**受限的线性排序程序参数**（根/分数/深度/年龄权重、batch 大小、停滞轮数），不是论文里任意可执行策略代码的完整复现。它能检验“改进探索策略”的闭环，但不能表达复杂策略结构。
- `evaluatorCommand` 在宿主机运行，插件本身**不提供安全沙箱**。只应在可信工作区、可信评测命令和已隔离的 Harness 环境中使用。不要将模型生成的策略代码直接 `eval` 或加载到宿主进程。
- 还没有论文的领域适配、原始超参数/提示词、外部 holdout 评测和大规模实验结果；也没有宣称复现论文收益。

运行 `npm test` 检查在线树、prefix-only replay、非法动作与策略晋级语义；`npm run check` 做类型检查。示例评测可单独用 `node examples/toy/evaluate.mjs examples/toy/seed` 验证。

后续真实会话验证和社区展示步骤见 [发布清单](docs/release.md)。

本项目采用 [MIT 许可证](LICENSE)，是非官方社区实现，不代表 DeepSeek 或 Dream-RSI 论文作者。
