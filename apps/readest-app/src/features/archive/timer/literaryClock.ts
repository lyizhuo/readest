/**
 * A "literary clock": real literature lines paired with a time of day, so an
 * idle/paused timer can show the quote closest to the current wall time.
 * Curated by hand; `line` is capped at 40 chars so it fits the dark page.
 */

export interface LiteraryClockEntry {
  /** Time of day this line belongs to, `HH:mm` (24h). */
  hhmm: string;
  /** Quote body, ≤ 40 characters. */
  line: string;
  /** Attribution, e.g. `马尔克斯《百年孤独》`. */
  source: string;
}

export const LITERARY_CLOCK: LiteraryClockEntry[] = [
  { hhmm: '00:30', line: '姑苏城外寒山寺，夜半钟声到客船。', source: '张继《枫桥夜泊》' },
  { hhmm: '01:00', line: '寒塘渡鹤影，冷月葬花魂。', source: '曹雪芹《红楼梦》' },
  { hhmm: '01:45', line: '醉里挑灯看剑，梦回吹角连营。', source: '辛弃疾《破阵子》' },
  { hhmm: '02:00', line: '夜深知雪重，时闻折竹声。', source: '白居易《夜雪》' },
  { hhmm: '02:30', line: '三十年前的月亮早已沉下去。', source: '张爱玲《金锁记》' },
  { hhmm: '02:45', line: '黑夜里，圣特莱莎的街道空无一人。', source: '波拉尼奥《2666》' },
  { hhmm: '03:00', line: '随风潜入夜，润物细无声。', source: '杜甫《春夜喜雨》' },
  { hhmm: '03:30', line: '老人梦见了狮子。', source: '海明威《老人与海》' },
  {
    hhmm: '04:00',
    line: '死并非生的对立面，而作为生的一部分永存。',
    source: '村上春树《挪威的森林》',
  },
  { hhmm: '04:30', line: '今宵酒醒何处？杨柳岸，晓风残月。', source: '柳永《雨霖铃》' },
  { hhmm: '05:00', line: '晓看红湿处，花重锦官城。', source: '杜甫《春夜喜雨》' },
  { hhmm: '05:15', line: '鸡声茅店月，人迹板桥霜。', source: '温庭筠《商山早行》' },
  { hhmm: '05:30', line: '世界新生伊始，许多事物还没有名字。', source: '马尔克斯《百年孤独》' },
  { hhmm: '05:45', line: '雄鸡一声天下白。', source: '李贺《致酒行》' },
  { hhmm: '06:00', line: '晨兴理荒秽，带月荷锄归。', source: '陶渊明《归园田居》' },
  { hhmm: '06:45', line: '一天早晨，格里高尔从不安的睡梦中醒来。', source: '卡夫卡《变形记》' },
  { hhmm: '07:00', line: '两个黄鹂鸣翠柳，一行白鹭上青天。', source: '杜甫《绝句》' },
  { hhmm: '07:30', line: '小荷才露尖尖角，早有蜻蜓立上头。', source: '杨万里《小池》' },
  { hhmm: '08:00', line: '读书之乐乐何如？绿满窗前草不除。', source: '朱熹《四时读书乐》' },
  { hhmm: '08:15', line: '燕子去了，有再来的时候。', source: '朱自清《匆匆》' },
  { hhmm: '09:00', line: '人间四月芳菲尽，山寺桃花始盛开。', source: '白居易《大林寺桃花》' },
  {
    hhmm: '09:30',
    line: '我心里暗暗设想，天堂应是图书馆的模样。',
    source: '博尔赫斯《关于天赐的诗》',
  },
  { hhmm: '10:00', line: '晴空一鹤排云上，便引诗情到碧霄。', source: '刘禹锡《秋词》' },
  { hhmm: '10:45', line: '今天，妈妈死了。也许是昨天。', source: '加缪《局外人》' },
  { hhmm: '11:00', line: '纸上得来终觉浅，绝知此事要躬行。', source: '陆游《冬夜读书示子聿》' },
  { hhmm: '11:30', line: '接天莲叶无穷碧，映日荷花别样红。', source: '杨万里《晓出净慈寺》' },
  { hhmm: '12:00', line: '锄禾日当午，汗滴禾下土。', source: '李绅《悯农》' },
  { hhmm: '12:30', line: '过去都是假的，回忆是一条没有归途的路。', source: '马尔克斯《百年孤独》' },
  { hhmm: '13:30', line: '良辰美景奈何天，赏心乐事谁家院！', source: '汤显祖《牡丹亭》' },
  { hhmm: '15:00', line: '行到水穷处，坐看云起时。', source: '王维《终南别业》' },
  { hhmm: '15:30', line: '采菊东篱下，悠然见南山。', source: '陶渊明《饮酒》' },
  { hhmm: '16:00', line: '我见青山多妩媚，料青山见我应如是。', source: '辛弃疾《贺新郎》' },
  { hhmm: '17:00', line: '夕阳无限好，只是近黄昏。', source: '李商隐《登乐游原》' },
  { hhmm: '17:15', line: '有一天，我看了四十三次日落。', source: '圣埃克苏佩里《小王子》' },
  { hhmm: '17:30', line: '一道残阳铺水中，半江瑟瑟半江红。', source: '白居易《暮江吟》' },
  { hhmm: '17:45', line: '日之夕矣，羊牛下来。', source: '《诗经·君子于役》' },
  { hhmm: '18:00', line: '晚来天欲雪，能饮一杯无？', source: '白居易《问刘十九》' },
  { hhmm: '18:30', line: '大漠孤烟直，长河落日圆。', source: '王维《使至塞上》' },
  { hhmm: '19:00', line: '疏影横斜水清浅，暗香浮动月黄昏。', source: '林逋《山园小梅》' },
  {
    hhmm: '19:15',
    line: '穿过长长的隧道，便是雪国。夜空下一片白茫茫。',
    source: '川端康成《雪国》',
  },
  { hhmm: '19:30', line: '月上柳梢头，人约黄昏后。', source: '欧阳修《生查子》' },
  { hhmm: '20:00', line: '海上生明月，天涯共此时。', source: '张九龄《望月怀远》' },
  { hhmm: '20:45', line: '月光如银子，无处不可照及。', source: '沈从文《边城》' },
  { hhmm: '21:00', line: '明月几时有？把酒问青天。', source: '苏轼《水调歌头》' },
  { hhmm: '21:15', line: '今天晚上，很好的月光。', source: '鲁迅《狂人日记》' },
  { hhmm: '21:30', line: '举杯邀明月，对影成三人。', source: '李白《月下独酌》' },
  { hhmm: '21:45', line: '蓦然回首，那人却在灯火阑珊处。', source: '辛弃疾《青玉案》' },
  { hhmm: '22:00', line: '无言独上西楼，月如钩。', source: '李煜《相见欢》' },
  { hhmm: '22:30', line: '露从今夜白，月是故乡明。', source: '杜甫《月夜忆舍弟》' },
  { hhmm: '22:45', line: '昼短苦夜长，何不秉烛游！', source: '《古诗十九首·生年不满百》' },
  { hhmm: '23:00', line: '夜阑卧听风吹雨，铁马冰河入梦来。', source: '陆游《十一月四日风雨大作》' },
  { hhmm: '23:15', line: '缺月挂疏桐，漏断人初静。', source: '苏轼《卜算子》' },
  { hhmm: '23:30', line: '于是我们奋力前行，逆水行舟。', source: '菲茨杰拉德《了不起的盖茨比》' },
];

const CLOCK_TOLERANCE_MIN = 30;

function minutesOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  return d.getHours() * 60 + d.getMinutes();
}

/** Nearest quote within ±30 minutes of `nowMs`, else null. */
export function lookupClock(nowMs: number): LiteraryClockEntry | null {
  const mins = minutesOfDay(nowMs);
  let best: LiteraryClockEntry | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const entry of LITERARY_CLOCK) {
    const [h = 0, m = 0] = entry.hhmm.split(':').map(Number);
    const target = h * 60 + m;
    const raw = Math.abs(mins - target);
    const delta = Math.min(raw, 24 * 60 - raw);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = entry;
    }
  }
  return best !== null && bestDelta <= CLOCK_TOLERANCE_MIN ? best : null;
}
