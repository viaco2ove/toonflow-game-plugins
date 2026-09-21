tavo cli 命令使用
# 安装
在项目根目录执行，-e 表示可编辑模式（改代码立即生效）
pip install -e .
发布后（用户安装）
pip install toon-plugins
# 忽略path 的方式，激活的 python 里安装了就行
`python -m toon_plugins --help`

# `tavo` 命令全局可用
需要配置path 加入 python 路径

获得当前的python 路径
```
python -m pip --version
```

powershell
```
# 方式B：临时加到当前会话 PATH
$env:PATH += ";D:\ProgramData\miniconda3\Scripts"
```
