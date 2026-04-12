import os
from huey import SqliteHuey
db_path = os.path.join("/Users/satoshitanaka/Documents/brownie", ".brwn", "huey.db")
# 確実に永続化レイヤーが機能するように設定
huey = SqliteHuey(filename=db_path)
