# 单据类型识别说明

## 相关文件

- 规则配置文件：`backend/app/config/document_types.yaml`
- 规则加载与分类器：`backend/app/services/document_classifier.py`

## YAML 字段含义

- `type`：系统内部使用的单据类型标识，例如 `invoice`、`packing_list`。
- `label`：面向人阅读的单据类型名称。
- `filename_keywords`：文件名关键词，命中后可直接识别为该类型。
- `filename_regex`：文件名正则规则，用于补充关键词无法覆盖的命名形式。
- `content_keywords`：正文关键词，用于文件名识别失败后的内容兜底。
- `content_match_threshold`：内容关键词命中阈值，达到该数量才认为内容识别成功。

## 当前识别优先级

1. 用户手动指定的 `manual_type`。
2. 文件名识别：`classify_by_filename`。
3. 内容关键词兜底：`classify_by_content`。
4. `generic` / `other` 兜底。

内容关键词只在文件名未识别出明确业务类型时使用。已经由文件名识别为 `invoice`、`packing_list`、`bill_of_lading`、`shipping_instruction`、`po` 等明确类型的文件，不会被内容识别覆盖。

## 添加新单据类型

1. 在 `backend/app/config/document_types.yaml` 的 `document_types` 中新增一项。
2. 配置 `filename_keywords` 和必要的 `filename_regex`。
3. 配置 `content_keywords` 和合适的 `content_match_threshold`。
4. 补充 `document_classifier` 相关测试，覆盖文件名识别、内容识别和未命中场景。
5. 如果新类型需要在前端展示，再另行补充前端映射；本轮不修改前端。

## 是否需要重启

当前生产后端需要重启服务后才会加载新代码。

YAML 规则由 `lru_cache` 缓存，进程内可以通过 `reload_rules()` 清理缓存并重新加载规则，但当前生产没有后台热更新入口。

## 注意事项

- 关键词不要设置得过宽，避免把普通文本误判为业务单据。
- 内容识别只作为文件名识别失败后的兜底。
- 不要让内容识别覆盖明确的文件名识别结果。
