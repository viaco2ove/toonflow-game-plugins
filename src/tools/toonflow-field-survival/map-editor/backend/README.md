pip install -r requirements.txt
python server.py local

# 环境可选：local（默认）/ dev / prod
#   python server.py local
#   python server.py dev
#   python server.py prod
# 不带参数时按 NODE_ENV 兜底为 dev