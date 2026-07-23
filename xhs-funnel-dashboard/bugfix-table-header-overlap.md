# 图表四表头穿模修复

## 修复结果

已修复图表四横向移动表格后，鼠标悬停分组表头时数据透出表头的问题。

## 原因

`assets/dashboard.css` 中分组表头的 hover 规则将背景设置为 `inherit`。在 sticky 表头场景下，这会让表头悬停时失去原本不透明的分组底色，露出下方滚动的数据。

## 修改

- 文件：`assets/dashboard.css`
- 移除分组表头的多余 hover 背景继承规则。
- 保留五个业务分组原有底色、文字色和 sticky 层级。
- 未修改数据处理、指标口径、JavaScript 或其他交互。

## 验证

- 表头 hover 透明背景规则已不存在。
- 五个分组底色规则完整。
- sticky 表头保持 `z-index: 2`，冻结列表头保持更高层级。
- CSS diff 格式检查通过。
- JavaScript 语法检查通过。
