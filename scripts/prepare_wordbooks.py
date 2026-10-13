"""Generate small offline word lists; definitions come from the installed ECDICT."""
import argparse,csv,json,re,sqlite3,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--sat-csv',type=Path,required=True);parser.add_argument('--sat-license',type=Path,required=True);args=parser.parse_args()
out=ROOT/'assets'/'wordbooks';out.mkdir(exist_ok=True)
database=sqlite3.connect(ROOT/'assets'/'dictionary.sqlite')
sat=list(dict.fromkeys(row['word'].strip().lower() for row in csv.DictReader(args.sat_csv.open(encoding='utf-8-sig')) if re.fullmatch(r"[a-z][a-z' -]{0,59}",row['word'].strip().lower())))
manifest=[]
for key,name,words,source in [('sat','SAT 阅读词汇（精选）',sat,'https://github.com/kahngjoonkoh/SAT_word_list'),('toefl','TOEFL 词汇',None,'https://github.com/skywind3000/ECDICT'),('ielts','IELTS 词汇',None,'https://github.com/skywind3000/ECDICT')]:
 if words is None:words=[word for word,tags in database.execute('SELECT word,tags FROM entries WHERE tags LIKE ? ORDER BY word',('%'+key+'%',)) if key in tags.split() and re.fullmatch(r"[a-z][a-z' -]{0,59}",word) and len(word.split())<=6]
 (out/(key+'.json')).write_text(json.dumps(words,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 manifest.append({'id':key,'name':name,'count':len(words),'description':'开放学习词表；SAT 为精选，TOEFL / IELTS 按 ECDICT 标签收录。并非考试机构官方词表。','source':source,'license':'MIT'})
 print(key,len(words))
(out/'index.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copyfile(args.sat_license,out/'SAT-LICENSE.txt')
