# 案例结构

每个案例位于 `assets/cases/<dimension>/<case-id>/`：

```text
case.json
task.md
input/
expected.json      可选，只供校验器使用
```

`case.json` 必填字段：

- `id`：全库唯一，使用小写字母、数字和连字符。
- `dimension` 与 `dimension_label`。
- `level`：`standard` 或 `pressure`。
- `title`、`version`、`enabled`。
- `task_file`、`input_dir`。
- `submission_files`：待测模型必须生成的相对路径。
- `checks`：确定性检查列表。
- `capabilities`：如 `web`、`image`、`browser`。

支持的检查类型：

- `file_exists`
- `text_length`
- `contains_all`
- `contains_none`
- `regex_count`
- `url_count`
- `json_keys`
- `json_match`
- `file_count`
- `command`
- `case_command`

检查可以设置 `severity` 为 `error` 或 `warning`。自动检查不得评价洞察、AI 味或审美。

`case_command` 只允许运行案例目录内预置的 Python 或 Node 校验脚本，并把 submission 目录作为最后一个参数传入。它适合检查项目功能或 Skill 结构，脚本不会复制给待测模型。

任务运行时只复制 `task.md` 与 `input/`。`case.json` 和 `expected.json` 留在 Skill 源目录中，由校验器读取。
