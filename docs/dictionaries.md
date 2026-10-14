# 自定义离线词典

在“查单词”或设置中打开“管理词典”。支持逐条添加与编辑，或导入以下文件；导入预览确认后才安装。文件与索引保存在资料目录的 `dictionaries` 子目录，重启后无需重导入。迁移或完整备份时复制整个 `data` 目录。

## CSV / TSV

UTF-8 编码，第一行需有 `word` 列。可选 `translation`、`definition`、`phonetic`、`exchange`、`tags`、`example`、`exampleTranslation`、`collocation`。中文列名也支持。CSV 的多行释义应使用双引号包围；重复词条保留文件中的第一条，并在预览中显示忽略的数量。

```csv
word,translation,definition,phonetic,example,exampleTranslation,collocation
competence,能力；[法] 管辖权,the ability to do something well,,Her competence is clear.,她的能力很明显。,professional competence
```

## JSON

可使用词条数组，或 `name` 与 `entries` 对象。每个词条至少包含 `word` 和一种释义。例句、搭配支持字符串或带译文的对象。

```json
{
  "name": "My English dictionary",
  "entries": [{
    "word": "competence",
    "translation": "能力；[法] 管辖权",
    "definition": "the ability to do something well",
    "phonetic": "ˈkɒmpɪtəns",
    "exchange": "s:competences",
    "examples": [{"text": "Her competence is clear.", "translation": "她的能力很明显。"}],
    "collocations": [{"text": "professional competence", "translation": "专业能力"}]
  }]
}
```

`exchange` 使用 ECDICT 词形代码：`p` 过去式、`d` 过去分词、`i` 现在分词、`3` 第三人称单数、`s` 复数、`r` 比较级、`t` 最高级、`0` 原形。多个字段用 `/` 分隔。

## StarDict

选择 `.ifo`，同目录保留同名 `.idx`（或 `.idx.gz`）、`.dict`（或 `.dict.dz`）。支持 2.4.2 / 3.0.0、32 / 64 位偏移、音标、文字和 HTML / XDXF 文字释义及 `.syn` 别名。导入内容以文字显示；外部脚本、音频和图片不会执行或自动下载。当前不直接支持 MDX / MDD。

CSV / TSV / JSON 和单个压缩文件上限 128 MB；压缩后的词典数据最多展开至 512 MB。导入在后台建立查询索引，不改动原文件。查询保留完整释义，并标注词典来源；删除词典不会删除已经保存的生词。

## 内置来源与 AI 补充

- [ECDICT](https://github.com/skywind3000/ECDICT)，MIT：完整库扩充专业词语与短语，已有基础库的校对条目优先保留。
- [Open English WordNet 2025](https://en-word.net/downloads)，CC BY 4.0：保留英英义项与已有例句；近义词按同一个义项查询。
- CC-CEDICT，CC BY-SA 4.0：简繁体汉英查询。

用法与专业释义的 AI 补充只在点击按钮后生成，按词条、释义与接口配置缓存。AI 补充明确标注来源，和离线词典内容区分。未收录单词在独立查词页面仍可使用配置的 AI 接口查询。

开发构建完整版词库：先运行 `scripts/prepare_assets.py`，安装构建依赖 `py7zr` 并运行 `scripts/prepare_dictionary_full.py`，再运行 `scripts/prepare_wordnet.py`。这些 Python 工具只用于准备发布资源，应用内导入词典无需 Python。
