# 生图

你正在执行“生图”skill，用 OpenAI-compatible Images API 生成图片。

## 安全规则

- 不要要求用户在聊天中明文发送 API key。
- 不要把 API key 写入代码、日志、Markdown、git、截图或输出结果。
- 优先从环境变量读取：`OPENAI_API_KEY`、`OPENAI_BASE_URL`。
- 必须显式配置 `OPENAI_BASE_URL`，不要默认走公网 OpenAI。
- 用户在国内或使用公司内网时，必须支持自定义 `OPENAI_BASE_URL`，例如公司网关的 `/v1` 地址。
- 如果缺少环境变量，脚本会读取 `~/.claude/secrets/shengtu.env`；这个文件必须由用户自己创建，不要代写密钥。
- 如果缺少配置，告诉用户用 `!` 在当前会话里创建或临时设置，不要持久写入系统配置，除非用户明确要求。

## 默认参数

- 模型：`gpt-image-2`
- 输出目录：当前工作目录下 `generated-images/`
- 输出格式：`png`
- 默认尺寸：`1024x1024`

## 使用方式

调用脚本：

```bash
node "C:/Users/duansb/.claude/skills/生图/scripts/generate-image.mjs" \
  --prompt "图片描述" \
  --out "generated-images/output.png"
```

可选参数：

```bash
--model gpt-image-2
--size 1024x1024
--quality high
--background transparent
--format png
--base-url https://your-company-gateway/v1
```

## 环境变量

```bash
export OPENAI_API_KEY="你的 key"
export OPENAI_BASE_URL="公司内网 OpenAI-compatible 地址，通常以 /v1 结尾"
```

Windows Git Bash 临时设置示例：

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_BASE_URL="https://xxx.company.com/v1"
```

推荐的本地私密文件方式：

```bash
mkdir -p ~/.claude/secrets
cat > ~/.claude/secrets/shengtu.env <<'EOF'
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://xxx.company.com/v1
EOF
```

## 执行流程

1. 根据用户需求整理英文或中文 prompt，保留用户指定风格、比例、文字、主体和禁忌。
2. 若未提供文件名，自动生成安全文件名。
3. 调用 `generate-image.mjs`。
4. 生成后返回本地图片路径。
5. 如接口报错，只说明错误类型，不泄露 key 或完整请求头。

## 国内/公司内网注意

- 如果公司接口不是标准 `/images/generations`，先询问接口路径或让用户提供内部文档。
- 如果公司接口兼容 OpenAI，一般只需要设置 `OPENAI_BASE_URL` 为内网 `/v1` 地址。
- 如果公司模型名不是 `gpt-image-2`，使用用户指定的模型名。
