# Personal Knowledge RAG 界面功能说明

本文档介绍当前 MVP 版本中各个页面与界面区域的功能，方便日常使用、产品说明和后续迭代时对照。

## 整体结构

当前应用主要由两部分组成：

- 左侧侧边栏：负责导航、导入、重建索引和状态提示
- 右侧主内容区：根据当前页面显示 Library、Chat、Document Detail、Settings 等内容

主界面顶部还提供一个统一的提问输入区，用户可以随时发起问题检索。

## 左侧侧边栏

左侧区域主要承担导航和全局操作功能。

### 1. 产品标题区

显示应用名称与一句简短介绍：

- `Personal Knowledge RAG`
- 说明这是一个本地优先、带引用的知识库问答应用

作用：

- 帮助用户快速确认当前应用定位
- 为后续桌面版本的品牌展示预留空间

### 2. 导航区

当前包括三个入口：

- `Library`
- `Chat`
- `Settings`

作用如下：

#### Library

进入知识库文档列表页。

主要用于：

- 查看当前已导入的文档
- 浏览每个文档的标题、文件名、文件类型、chunk 数量
- 打开某个文档的详情页

#### Chat

进入问答结果页。

主要用于：

- 查看当前问题的直接答案
- 查看 supporting points
- 查看 citations / source passages

#### Settings

进入设置页。

主要用于：

- 调整 chunk size
- 调整 chunk overlap
- 控制当前索引切片策略

### 3. 全局操作按钮

当前侧边栏有两个核心按钮：

- `Import Files`
- `Reindex`

#### Import Files

作用：

- 打开 macOS 原生文件选择器
- 选择本地文件导入到知识库中

当前支持的文件格式：

- `pdf`
- `md`
- `txt`
- `docx`

导入后的处理流程：

1. 读取文件内容
2. 解析文本
3. 生成更自然的 chunk
4. 建立本地索引
5. 写入 SQLite 本地数据库

#### Reindex

作用：

- 使用当前设置重新生成所有已导入文档的 chunk 和检索索引

适用场景：

- 调整了 `chunk size` 或 `chunk overlap`
- 升级了切片策略
- 升级了 embedding / retrieval 策略
- 想让旧文档重新按新规则建索引

### 4. Status 状态区

状态区用于展示系统当前状态。

当前会显示：

- 当前操作状态，例如：
  - `Ready`
  - `Import complete`
  - `Reindex complete`
  - `Answer ready`
  - `Import failed`
- 当前已索引文档数量
- 错误信息（如果某个操作失败）

作用：

- 让用户知道系统当前在做什么
- 在导入或检索失败时提供即时反馈

## 顶部提问区

右侧主区域顶部有统一的问答输入框与 `Ask` 按钮。

作用：

- 用户可以直接输入自然语言问题
- 无论当前在 Library、Chat 或其他页面，都可以快速发起一次问答

例如：

- `什么是 stable diffusion?`
- `最近关于检索设计的更新是什么？`
- `我的笔记里提到过哪些 chunking 策略？`

提问后系统会执行：

1. 查询本地知识库
2. 进行混合检索
3. 进行 rerank
4. 组织答案
5. 返回直接答案、supporting points 和 citations

## Library 页面

Library 页面用于管理已导入文档。

### 当前显示内容

每个文档卡片会显示：

- 文档标题
- 原始文件名
- 文件类型
- chunk 数量
- 更新时间

### 当前支持操作

点击某个文档后，会进入 `Document Detail` 页面。

适合的使用方式：

- 看看哪些文件已经成功导入
- 判断某个文件是否被成功切片
- 检查索引后的规模是否合理

## Chat 页面

Chat 页面是当前 RAG 问答的核心页面。

它主要分为左右两块：

- 左侧：答案区
- 右侧：引用区

### 左侧答案区

包含两个核心部分：

#### 1. Direct Answer

这是系统先给出的简洁回答。

目标：

- 先回答问题本身
- 不要求把所有证据都堆出来
- 让用户先快速得到结论

同时还会显示：

- 该答案基于多少个文档
- 当前答案是否主要来自单一文档

#### 2. Key Supporting Points

这是对 Direct Answer 的补充说明。

目标：

- 提供 2 到 3 条关键支撑点
- 帮助用户快速理解答案为什么成立
- 避免直接拼接原文大段内容

当前已针对这块做过优化：

- 过滤半截句
- 过滤孤立编号
- 优先抽取完整句
- 避免把不完整的列表项直接展示出来

### 右侧引用区

右侧 `Source passages` 用于展示检索命中的证据块。

每张 citation 卡片当前显示：

- 文档标题
- 原始文件名
- chunk 编号
- section 信息
- 更新时间
- snippet 摘要

### Citation 卡片的展开功能

当前 citation 卡片支持：

- 默认显示高质量 snippet
- 点击 `Show full chunk` 展开完整 chunk
- 点击 `Hide full chunk` 收起完整内容

作用：

- 默认保持页面整洁
- 用户怀疑引用是否被截断时，可以直接查看完整 chunk
- 有助于验证答案是否真正 grounded

## Document Detail 页面

Document Detail 页面用于查看某个文档的完整切片结果。

### 当前显示内容

页面会展示：

- 文档标题
- 文件类型
- chunk 数量
- 更新时间
- 本地文件路径

下方会逐个展示该文档的 chunk。

每个 chunk 卡片显示：

- `Chunk N`
- token 数量
- section title
- section path
- chunk 文本内容

### 当前支持操作

页面顶部支持：

- `Open Source File`

作用：

- 用系统默认方式打开原始文件
- 方便回到源文件继续核对上下文

这个页面主要用于：

- 检查 chunk 切片质量
- 看某个 section 是否被正确保留
- 排查“答案为什么检索到了这段内容”

## Settings 页面

Settings 页面当前聚焦在 chunking 参数控制。

### 当前参数

#### Chunk size

控制单个 chunk 的目标大小。

影响：

- 值更大：单个 chunk 包含更多上下文，但可能不够聚焦
- 值更小：检索更细，但可能更容易碎片化

#### Chunk overlap

控制相邻 chunk 之间的重叠部分。

影响：

- overlap 更大：上下文衔接更稳定
- overlap 更小：索引更紧凑，但可能丢失边界上下文

### 设置页的作用

它主要服务于研发/调优阶段：

- 调整切片质量
- 对比不同 chunking 参数的效果
- 配合 `Reindex` 做索引重建

## 当前问答工作流

从用户角度看，一次典型使用流程如下：

1. 点击 `Import Files`
2. 导入 `pdf / md / txt / docx`
3. 在 `Library` 查看文档是否导入成功
4. 在顶部输入框提问
5. 在 `Chat` 页面查看：
   - Direct Answer
   - Key Supporting Points
   - Source passages
6. 如需核对证据：
   - 展开 citation 查看完整 chunk
   - 或打开 `Document Detail`
   - 或直接点击 `Open Source File`

## 当前 MVP 的定位

当前版本更偏向一个：

- 本地优先知识库
- 带可检查引用的 RAG 桌面应用

而不是：

- 重型 autonomous agent
- 多步任务编排系统
- 自动执行工作流平台

因此当前界面设计重点放在：

- 导入知识
- 看清索引结果
- 问答
- 核对引用

## 后续可以继续增强的方向

基于当前界面，后续可以继续增加：

- citation 关键词高亮
- 只允许同时展开一个 citation
- source passage 内定位最相关句子
- Library 搜索与筛选
- 文档标签和分组
- 更明显的索引进度提示
- Chat 历史会话
- 回答置信度或证据覆盖度展示

## 文档适用范围

本文档基于当前仓库中的 MVP 实现整理，适用于：

- 产品介绍
- 功能梳理
- 开发对齐
- 测试与验收说明
