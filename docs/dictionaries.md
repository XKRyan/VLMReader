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

## MOBI 词典

选择未加密的 `.mobi` 词典即可在后台读取词条索引，支持 MOBI7 的未压缩与 PalmDOC 压缩格式。当前不支持 DRM、HUFF/CDIC、KF8-only 文件，也不能将普通 MOBI 电子书当作词典导入。

完整词典原文在查询结果中单独折叠显示，保留义项、用法说明、同义词说明与词源；查词页的原文交叉引用可点击或使用键盘打开。英文参考词典不会覆盖已有的中文释义与简洁复习提示。常见变形通过内置词形信息查询原形，不解析所有 MOBI 专有变形规则。原文件内的错误也会原样保留，应结合其他词典核对。

只显示经过清理的文字和排版；脚本、外链、图片与音频不会执行或自动下载。MOBI 文件上限 128 MB，文本展开上限 256 MB，单篇词条上限 4 MB。词典仅保存在自己的资料目录，程序发布包不包含导入的词典内容。

## MDX 词典

选择 `.mdx` 即可在后台读取词条索引，无需先转换格式。支持 MDict 1.2 与 2.0 两种引擎版本、UTF-8 与 UTF-16 编码，以及未压缩、zlib 与 LZO 三种块压缩。加密或带 DRM 的 MDX、以及 `.mdd` 资源包当前不受支持。

索引被加密（`Encrypted="2"`）的商业词典也能读取：加密的只是关键字索引块，键块本身仍是自描述 zlib 流，导入时逐块顺序解压即可走完全部词条。需要注册密钥（`Encrypted="1"`）的文件会被明确拒绝。

导入采用流式处理：正文按块解压、逐条写入 SQLite，不会把整本词典或整段正文留在内存里，因此 100 MB 以上的词典也能直接导入（上限 512 MB）。`node:sqlite` 不可用的运行时退回内存构建方式，仅适合较小的词典。

LDOCE 类词典的排版标记会被解析成结构化内容：`span.sense > span.def` 作为编号义项，`span.example` 与 `ul.exas li` 作为例句，`span.collocate` 作为搭配，`span.pron` 作为音标；`span.exponent`（THESAURUS / 相关词面板）用于说明**别的**词条，会被跳过，否则 `bank` 的第一条释义会变成 "the part of a river where it joins the sea"。没有这些标记的词典退回纯文本释义，完整 HTML 原文始终保留。

汉英类词典（新世纪汉英大等）的 `ol.info-list` 排版同样会解析：`i.number` 作为编号义项、`span.bold` 作为词性、`div.info-cite` 的中英对照句拆分成本地例句、相关词条作为搭配。词典里的 `@@@LINK=` 别名会解析成目标词条的内容，让「“阿波罗”计划」这类写法也能查到。

每条词条保留完整 HTML 原文，在查词结果中折叠显示、可展开阅读；与其他词典一样，显示前会清理脚本与外链。

> 商业词典（牛津高阶、朗文当代、汉英大词典等）的电子版属于版权内容。个人使用时请确认自己拥有正版授权；不要把它们打进发布包。

`scripts/import_mdx.py` 是同一流程的无界面版本，用于批量或自动化场景；它的抽取规则需与 `electron/mdx-dictionary.cjs` 保持一致。

## 内置来源与 AI 补充

- [ECDICT](https://github.com/skywind3000/ECDICT)，MIT：完整库扩充专业词语与短语，已有基础库的校对条目优先保留。
- [Open English WordNet 2025](https://en-word.net/downloads)，CC BY 4.0：保留英英义项与已有例句；近义词按同一个义项查询。
- CC-CEDICT，CC BY-SA 4.0：简繁体汉英查询。

用法与专业释义的 AI 补充只在点击按钮后生成，按词条、释义与接口配置缓存。AI 补充明确标注来源，和离线词典内容区分。未收录单词在独立查词页面仍可使用配置的 AI 接口查询。

开发构建完整版词库：先运行 `scripts/prepare_assets.py`，安装构建依赖 `py7zr` 并运行 `scripts/prepare_dictionary_full.py`，再运行 `scripts/prepare_wordnet.py`。这些 Python 工具只用于准备发布资源，应用内导入词典无需 Python。
