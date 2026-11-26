((root, data) => {
  if (typeof module !== 'undefined') module.exports = data;
  else root.PlanetV1Data = data;
})(globalThis, {
  "data": {
    "wake": {
      "title": "早上起床",
      "intro": "早安呀！☀️ 新的一天开始啦。你现在起床了吗？",
      "options": [
        {
          "id": "up",
          "label": "已经真正离床",
          "reply": "今天的第一步完成啦！晨间准备进行到哪里了？",
          "next": "@wake"
        },
        {
          "id": "in_bed",
          "label": "醒了，还在床上",
          "reply": "先不想今天要做什么，掀开被子，坐起来。现在做到哪一步了？",
          "next": "rise"
        },
        {
          "id": "back_in_bed",
          "label": "关了闹钟，又躺回去了",
          "reply": "我们重新开始这一步。先坐起来，再把双脚放到地面。现在怎么样了？",
          "next": "@backInBed"
        }
      ]
    },
    "am": {
      "title": "上午开始工作或学习",
      "intro": "上午的成长时间到啦！☀️ 来看看今天的重点，你现在是什么状态？",
      "options": [
        {
          "id": "started",
          "label": "已经开始了",
          "reply": "启动成功！按现在的节奏继续，小星先不打扰你啦。",
          "next": "@start"
        },
        {
          "id": "ready",
          "label": "准备开始，还没行动",
          "reply": "打开当前任务需要的第一份材料，先做一个小步骤。现在开始了吗？",
          "next": "begin"
        },
        {
          "id": "other_activity",
          "label": "还在做其他事情",
          "reply": "你现在的事情属于哪一种？",
          "next": "otherActivity"
        },
        {
          "id": "difficulty",
          "label": "想开始，但有困难",
          "reply": "现在最主要的困难是什么？",
          "next": "barrier"
        }
      ]
    },
    "pm": {
      "title": "下午开始工作或学习",
      "intro": "下午好呀！我们来看看下午最需要推进的事情。你现在是什么状态？",
      "options": [
        {
          "id": "started",
          "label": "已经开始了",
          "reply": "下午的行动已经启动！继续手头的任务吧。",
          "next": "@start"
        },
        {
          "id": "ready",
          "label": "准备开始，还没行动",
          "reply": "回到工作位置，打开下午的第一份任务材料。现在开始了吗？",
          "next": "begin"
        },
        {
          "id": "other_activity",
          "label": "还在做其他事情",
          "reply": "你还在进行哪类活动？",
          "next": "otherActivity"
        },
        {
          "id": "difficulty",
          "label": "想开始，但有困难",
          "reply": "现在最主要的困难是什么？",
          "next": "barrier"
        }
      ]
    },
    "check": {
      "title": "下午学习中途的状态监督",
      "intro": "小星来看看你啦！✨ 现在的你正在做什么？",
      "options": [
        {
          "id": "focused",
          "label": "正在专注",
          "reply": "很好，保持现在的节奏，小星先不打扰你啦。",
          "next": "@check"
        },
        {
          "id": "distracted",
          "label": "有点分心，或已经偏航",
          "reply": "现在是哪一种情况？",
          "next": "attention"
        },
        {
          "id": "planned_break",
          "label": "正在休息或另有安排",
          "reply": "先把当前安排照顾好。你什么时候适合继续？",
          "next": "checkBreak"
        },
        {
          "id": "not_started",
          "label": "到现在还没开始",
          "reply": "不用追回之前的时间。我们先看看现在卡在哪里。",
          "next": "barrier"
        }
      ]
    },
    "dinner": {
      "title": "晚上吃饭",
      "intro": "到晚饭时间啦！记得照顾好自己。你现在吃晚饭了吗？",
      "options": [
        {
          "id": "finished",
          "label": "已经吃完了",
          "reply": "晚餐结束啦！现在方便准备洗澡了吗？",
          "next": "@dinner"
        },
        {
          "id": "eating",
          "label": "正在吃饭",
          "reply": "安心吃饭，吃完再来告诉我就好。",
          "next": "dinnerEating"
        },
        {
          "id": "ready",
          "label": "还没吃，准备去吃",
          "reply": "把手头事情停在一个方便继续的位置，准备吃饭吧。",
          "next": "dinnerReady"
        },
        {
          "id": "busy",
          "label": "还没吃，暂时不能去",
          "reply": "是还在忙，还是现在不适合吃饭？",
          "next": "dinnerBusy"
        }
      ]
    },
    "bath": {
      "title": "洗澡",
      "intro": "到洗澡时间啦！🫧 如果还没开始，可以先选计时模式再去洗澡。现在进行到哪一步了？",
      "options": [
        {
          "id": "finished",
          "label": "洗澡及计划内整理已全部完成",
          "reply": "清清爽爽地回来啦！今天的洗浴任务完成了。",
          "next": "@bath"
        },
        {
          "id": "in_progress",
          "label": "正在洗澡或整理",
          "reply": "先完成手头的事情，不需要现在回复。结束后再确认。",
          "next": "bathResult"
        },
        {
          "id": "ready",
          "label": "准备去洗澡",
          "reply": "准备好换洗衣物。如果想计时，选好模式再开始。",
          "next": "bathTimer"
        },
        {
          "id": "busy",
          "label": "暂时还不能去",
          "reply": "现在是什么让你还不能开始？",
          "next": "bathBusy"
        }
      ]
    },
    "night": {
      "title": "晚上开始工作或学习",
      "intro": "晚上的专注时间到啦！我们根据今天的进度，推进一件重要的事。现在是什么状态？",
      "options": [
        {
          "id": "started",
          "label": "已经开始了",
          "reply": "晚间启动成功！保持现在的节奏吧。",
          "next": "@start"
        },
        {
          "id": "ready",
          "label": "准备开始，还没行动",
          "reply": "打开今晚重点任务的材料，先做一个小步骤。开始了吗？",
          "next": "begin"
        },
        {
          "id": "other_activity",
          "label": "还在做其他事情",
          "reply": "你还在进行哪类活动？",
          "next": "otherActivity"
        },
        {
          "id": "difficulty",
          "label": "想开始，但有困难",
          "reply": "现在最主要的困难是什么？",
          "next": "barrier"
        }
      ]
    },
    "sleep": {
      "title": "睡觉与每日复盘",
      "intro": "夜深啦，🌙 今天的事情可以慢慢收尾了。你现在准备到哪一步了？",
      "options": [
        {
          "id": "in_bed",
          "label": "已经上床了",
          "reply": "不需要再起来做其他事情。现在准备放下手机休息了吗？",
          "next": "sleepInBed"
        },
        {
          "id": "ready",
          "label": "准备睡前收尾",
          "reply": "辛苦啦！如果还有想法，可以在上床前简单说给我听。",
          "next": "sleepReady"
        },
        {
          "id": "busy",
          "label": "还在工作或娱乐",
          "reply": "现在主要在做什么？",
          "next": "sleepBusy"
        },
        {
          "id": "difficulty",
          "label": "还不想睡或睡不着",
          "reply": "是什么让现在的收尾有点困难？",
          "next": "sleepBarrier"
        }
      ]
    }
  },
  "quotes": [
    {
      "id": "seed-1",
      "theme": "自我效能",
      "lines": [
        "我有能力完成我想做的事。",
        "今天，从一小步开始。"
      ]
    },
    {
      "id": "seed-2",
      "theme": "行动优先",
      "lines": [
        "不必等到状态完美才开始。",
        "行动本身就会带来新的力量。"
      ]
    },
    {
      "id": "seed-3",
      "theme": "自我接纳",
      "lines": [
        "我可以按照自己的节奏成长。",
        "每一份努力都有它的意义。"
      ]
    },
    {
      "id": "seed-4",
      "theme": "专注当下",
      "lines": [
        "不必一次解决所有问题。",
        "做好眼前这一件事，就已经很好。"
      ]
    },
    {
      "id": "seed-5",
      "theme": "掌控生活",
      "lines": [
        "我的生活可以由我一点点塑造。",
        "今天的每一个小行动，都在创造我想要的生活。"
      ]
    },
    {
      "id": "seed-6",
      "theme": "重新开始",
      "lines": [
        "昨天的状态不决定今天的可能。",
        "每一个清晨，都是一次新的出发。"
      ]
    },
    {
      "id": "seed-7",
      "theme": "长期成长",
      "lines": [
        "每一次微小的进步，都在悄悄积累。",
        "时间会让坚持变得有分量。"
      ]
    },
    {
      "id": "seed-8",
      "theme": "内在力量",
      "lines": [
        "我比自己想象中更有力量。",
        "那些看似困难的事情，可以一步一步完成。"
      ]
    },
    {
      "id": "seed-9",
      "theme": "减少内耗",
      "lines": [
        "不必把所有事情都想清楚才行动。",
        "有些答案，会在前进的过程中出现。"
      ]
    },
    {
      "id": "seed-10",
      "theme": "允许不完美",
      "lines": [
        "今天不需要完美，只需要真实地向前。",
        "完成一点，也是一种成功。"
      ]
    },
    {
      "id": "seed-11",
      "theme": "回归能力",
      "lines": [
        "偶尔偏离轨道，也可以重新找回方向。",
        "每一次回归，都是能力的增长。"
      ]
    },
    {
      "id": "seed-12",
      "theme": "积极期待",
      "lines": [
        "今天还有许多美好的可能。",
        "带着一点好奇和勇气，去开启新的一天。"
      ]
    },
    {
      "id": "seed-13",
      "theme": "信任自己",
      "lines": [
        "我值得信任，也有能力照顾好自己。",
        "今天，我会用行动回应自己的期待。"
      ]
    },
    {
      "id": "seed-14",
      "theme": "情绪与行动",
      "lines": [
        "我可以带着不同的情绪继续前进。",
        "我的下一步，不必由此刻的心情决定。"
      ]
    },
    {
      "id": "seed-15",
      "theme": "摆脱比较",
      "lines": [
        "我有属于自己的成长节奏。",
        "每一小步都值得被看见。"
      ]
    },
    {
      "id": "seed-16",
      "theme": "珍惜时间",
      "lines": [
        "今天的时间，是送给自己的一份礼物。",
        "把它留给真正重要和喜欢的事情。"
      ]
    },
    {
      "id": "seed-17",
      "theme": "面对困难",
      "lines": [
        "困难的事情，不需要一次做完。",
        "我只需要勇敢地迈出第一步。"
      ]
    },
    {
      "id": "seed-18",
      "theme": "生活愿景",
      "lines": [
        "我正在一点一点靠近自己喜欢的生活。",
        "今天的努力，是在为未来的自己积攒礼物。"
      ]
    },
    {
      "id": "seed-19",
      "theme": "温柔坚定",
      "lines": [
        "温柔地对待自己，坚定地走向目标。",
        "我可以同时拥有松弛感和行动力。"
      ]
    },
    {
      "id": "seed-20",
      "theme": "当下的幸福",
      "lines": [
        "生活不只存在于未来的目标里。",
        "认真度过今天，也是一件很美好的事。"
      ]
    }
  ],
  "rewards": {
    "wake": [
      [
        "早安！成功离床，今天的星球正式开始运转啦！",
        "起床任务完成！你已经赢下了今天的第一关！",
        "哇！今天的第一颗星星被你点亮啦！",
        "小星为你鼓掌！你已经迈出了今天的第一步。",
        "叮！晨间能量已到账！"
      ],
      [
        "哇！准时起床成功！今天的第一颗超级星星属于你！",
        "漂亮！你成功掌握了今天的起床节奏！",
        "晨间成就达成！今天开了一个漂亮的好头！"
      ]
    ],
    "am": [
      [
        "叮！上午专注模式成功开启！",
        "启动成功！最关键的第一步已经完成啦。",
        "太棒了！你把想法变成了行动。",
        "收获一颗行动星！每一次开始都值得庆祝。",
        "上午任务已启动，梦想进度条又向前了一格！"
      ],
      [
        "哇哦！准时启动，专注力正在闪闪发光！",
        "行动力升级！你正在成为自己生活的掌舵者。",
        "上午专注成就达成！奖励一颗闪耀行动星！"
      ]
    ],
    "pm": [
      [
        "下午能量重新上线！欢迎进入专注模式。",
        "叮！下午行动星已收入囊中。",
        "很棒！你正在把今天过成自己想要的样子。",
        "午后专注副本开启，小星陪你继续前进！",
        "下午的第一步已经完成，接下来一点一点推进就好。"
      ],
      [
        "午后能量满格！又一次成功掌握了自己的节奏。",
        "太漂亮了！下午专注任务准时启动！",
        "叮！行动力升级，超级星星已到账！"
      ]
    ],
    "night": [
      [
        "夜间专注模式已开启！",
        "又一次主动选择了对自己重要的事情，真不错！",
        "晚间行动星已到账，按照自己的节奏前进吧。",
        "小星已就位，陪你度过这段专注时光。",
        "今晚不求完美，只求一点真实的进展。"
      ],
      [
        "晚间专注成就达成！为你的行动力鼓掌！",
        "又一次准时赴约，赴的是和自己的约定。",
        "今晚的星球动力满格，超级行动星送给你！"
      ]
    ],
    "bath": [
      [
        "洗澡副本顺利通关！清清爽爽地回来啦。",
        "洗浴任务完成，给自己一颗星！",
        "清爽值上线，准备迎接接下来的时间吧！",
        "今天又完成了一次对自己的照顾。"
      ],
      [
        "哇！成功在目标时间内完成洗浴，效率星送给你！",
        "清爽值满格，时间管理技能升级！",
        "高效洗浴成就达成！奖励一颗闪耀效率星！"
      ]
    ],
    "sleep": [
      [
        "今日星球即将休眠，晚安，辛苦啦。",
        "请安心把剩下的事情交给明天。",
        "获得一颗自我照顾星，好好休息也是一种进步。",
        "今天的故事到这里就很好，明天我们再继续。",
        "星球充电模式已开启，祝你好梦。"
      ],
      [
        "今天的收尾真漂亮，奖励一颗特别的月亮星。",
        "你认真照顾了今天的自己，也为明天积攒了能量。",
        "准时进入充电模式，今晚可以安心休息啦。"
      ]
    ],
    "return": [
      [
        "欢迎回归！小星陪你继续出发。",
        "叮！成功重返轨道，获得一颗回归星！",
        "你刚刚完成了一次很有价值的注意力切换。",
        "能够重新开始，和顺利开始一样值得庆祝。",
        "不需要追回刚刚的时间，从现在继续就好。"
      ],
      [
        "哇！轨道修复成功，回归技能升级！",
        "超级回归星已解锁！你正在练习找回自己的节奏。",
        "你成功改变了刚才的行动方向，这是一次值得庆祝的进步！"
      ]
    ]
  },
  "phases": {
    "rise": {
      "question": "离床这一步进展怎么样？",
      "options": [
        {"id":"up","label":"已经离床","reply":"今天第一步完成啦！晨间准备进行到哪里了？","next":"@wake"},
        {"id":"sitting","label":"已经坐起来","reply":"双脚落地，站起来。","next":"rise"},
        {"id":"stuck","label":"还是起不来","reply":"现在坐起来和双脚落地，哪一步最难？","next":"wakeCare","guide":true}
      ]
    },
    "wakeCare": {
      "question": "身体状态还好吗？",
      "options": [
        {"id":"try","label":"可以继续尝试","reply":"先把一只脚伸到床边。","next":"rise"},
        {"id":"pause","label":"身体不舒服，需要暂停","reply":"先照顾身体，监督可以暂停。","next":"@pause"}
      ]
    },
    "morningProgress": {
      "question": "晨间准备进行到哪里了？",
      "options": [
        {"id":"unwashed","label":"还没洗漱","reply":"先去洗手间，完成洗漱吧。","next":"wash"},
        {"id":"washed","label":"已洗漱，还在准备","reply":"按照你的晨间安排，完成剩下的准备。","next":"breakfast"},
        {"id":"ready","label":"晨间准备都好了","reply":"来看看今天的第一项任务。","next":"@handoff"}
      ]
    },
    "wash": {
      "question": "洗漱进行得怎么样？",
      "options": [
        {"id":"finished","label":"已洗漱","reply":"接下来完成剩余晨间准备。","next":"breakfast"},
        {"id":"doing","label":"正在洗漱","reply":"洗完再确认。","next":"wash"},
        {"id":"pending","label":"还没开始","reply":"先走到洗手间。","next":"wash","guide":true}
      ]
    },
    "breakfast": {
      "question": "晨间准备好了吗？",
      "options": [
        {"id":"ready","label":"已准备好","reply":"来看看今日重点。","next":"@handoff"},
        {"id":"doing","label":"还在准备","reply":"先完成手头的事情。","next":"breakfast"},
        {"id":"pending","label":"还没开始准备","reply":"先准备你接下来要用的东西。","next":"breakfast","guide":true}
      ]
    },
    "barrier": {
      "question": "现在最主要的困难是什么？",
      "options": [
        {"id":"unclear","label":"不知道怎么做或任务太难","reply":"先把「{task}」缩小成一个现在能做的动作。","next":"@barrier:begin","guide":true},
        {"id":"attention","label":"不想动或注意力不在这里","reply":"先把当前任务的材料摆到眼前。","next":"@barrier:begin","guide":true},
        {"id":"energy","label":"情绪或身体状态不好","reply":"先照顾此刻的身体和情绪。需要休息的话，可以暂停监督。","next":"@barrier:begin","guide":true}
      ]
    },
    "otherActivity": {
      "question": "你还在进行哪类活动？",
      "options": [
        {"id":"necessary","label":"计划内或必要的事情","reply":"安心完成现在的事，再约一个回归时间。","next":"@wait:begin"},
        {"id":"detour","label":"临时被其他事情吸引","reply":"先给手头这件事找个停止点。","next":"@detour:back","guide":true},
        {"id":"switch","label":"现在可以切换","reply":"{firstStep}","next":"begin"}
      ]
    },
    "begin": {
      "question": "这个小步骤开始了吗？",
      "options": [
        {"id":"started","label":"已经开始","reply":"启动成功，继续就好。","next":"@start"},
        {"id":"stuck","label":"还是没开始","reply":"我们看看卡在哪里。","next":"barrier","guide":true}
      ]
    },
    "sustain": {
      "question": "当前这段工作怎么样了？",
      "options": [
        {"id":"focused","label":"还在专注","reply":"继续保持。","next":"sustain"},
        {"id":"target","label":"已持续专注达到目标","reply":"","next":"@focusTarget"},
        {"id":"interrupted","label":"已经中断","reply":"我们找回原任务。","next":"@detour:detour"},
        {"id":"wrapped","label":"已经收尾","reply":"把进度保存好。","next":"@wrap"}
      ]
    },
    "wrap": {
      "question": "现在可以收尾了吗？",
      "options": [
        {"id":"wrapped","label":"已经收尾","reply":"记录下次的第一步。","next":"@wrap"},
        {"id":"later","label":"还需要一点时间","reply":"先定一个停止点。","next":"@wait:wrap"}
      ]
    },
    "lunch": {
      "question": "午饭或午休进行得怎么样？",
      "options": [
        {"id":"finished","label":"已经结束，可以开始下午任务","reply":"接下来按你的下午计划走。","next":"@handoff"},
        {"id":"doing","label":"还在吃饭或休息","reply":"先安心吃饭或休息。","next":"lunch"},
        {"id":"plans","label":"还没开始吃饭或另有安排","reply":"先看看现在需要安排哪一件事。","next":"@wait:lunch","guide":true}
      ]
    },
    "attention": {
      "question": "现在是哪一种情况？",
      "options": [
        {"id":"still","label":"还在做原任务，但注意力不集中","reply":"把注意力放回手头正在做的这一小步。","next":"@barrier:attention","guide":true},
        {"id":"switched","label":"已经转去做其他事情","reply":"先找到现在这件事的停止点。","next":"@detour:detour","guide":true},
        {"id":"unclear","label":"说不清，被很多想法打断","reply":"试着说说刚才最吸引你注意力的一件事。","next":"@barrier:attention","guide":true}
      ]
    },
    "checkBreak": {
      "question": "你什么时候适合继续？",
      "options": [
        {"id":"now","label":"现在可以继续","reply":"{firstStep}","next":"begin"},
        {"id":"later","label":"稍后继续","reply":"选一个合适的时间再确认。","next":"@wait:checkBreak"},
        {"id":"adjust","label":"今天需要调整计划","reply":"可以先说说你想怎么调整。计划由你确认。","next":"@wait:checkBreak"}
      ]
    },
    "detour": {
      "question": "什么把你带离原来的任务？",
      "options": [
        {"id":"phone","label":"手机娱乐或聊天","reply":"先找到停止点，把注意力移回原任务。","next":"@strategy","guide":true},
        {"id":"idea","label":"新想法或查资料越查越远","reply":"记下链接或想法，回到最初目标。","next":"@strategy","guide":true},
        {"id":"emotion","label":"情绪、走神或反复纠结","reply":"先标记当下的感受或想法。","next":"@strategy","guide":true},
        {"id":"task","label":"任务困难或不知道下一步","reply":"先找出原任务里最小的一个动作。","next":"@strategy","guide":true}
      ]
    },
    "recovery": {
      "question": "什么把你带离原来的任务？",
      "options": [
        {"id":"phone","label":"手机娱乐或聊天","reply":"先找到停止点，把注意力移回原任务。","next":"@strategy","guide":true},
        {"id":"idea","label":"新想法或查资料越查越远","reply":"记下链接或想法，回到最初目标。","next":"@strategy","guide":true},
        {"id":"emotion","label":"情绪、走神或反复纠结","reply":"先标记当下的感受或想法。","next":"@strategy","guide":true},
        {"id":"task","label":"任务困难或不知道下一步","reply":"先找出原任务里最小的一个动作。","next":"@strategy","guide":true}
      ]
    },
    "back": {
      "question": "现在回到原任务了吗？",
      "options": [
        {"id":"returned","label":"已经回到原任务","reply":"欢迎回来！","next":"@returned"},
        {"id":"switching","label":"正在切换","reply":"先完成当前一个转换动作。","next":"back"},
        {"id":"stuck","label":"还是回不去","reply":"我们换一种办法。现在最卡的是哪一步？","next":"detour","guide":true}
      ]
    },
    "backHold": {
      "question": "这次回归之后的行动怎么样？",
      "options": [
        {"id":"target","label":"已持续到目标时长","reply":"","next":"@returnTarget"},
        {"id":"brief","label":"只回归了一会儿","reply":"这一小段回归也值得记录。","next":"@returnBrief"}
      ]
    },
    "afterDinner": {
      "question": "现在方便准备洗澡了吗？",
      "options": [
        {"id":"home","label":"已到家，可以准备","reply":"可以按你的安排准备洗澡。","next":"@handoff"},
        {"id":"outside","label":"还在外面","reply":"到家后再确认。","next":"@wait:homeCheck"},
        {"id":"plans","label":"还有饭后安排","reply":"先完成你的饭后安排。可以约个合适的时间。","next":"@wait:homeCheck"}
      ]
    },
    "homeCheck": {
      "question": "现在方便准备洗澡了吗？",
      "options": [
        {"id":"home","label":"已到家，可以准备","reply":"可以按你的安排准备洗澡。","next":"@handoff"},
        {"id":"outside","label":"还在外面","reply":"到家后再确认。","next":"@wait:homeCheck"},
        {"id":"plans","label":"还有饭后安排","reply":"先完成你的饭后安排。可以约个合适的时间。","next":"@wait:homeCheck"}
      ]
    },
    "dinnerStart": {
      "question": "晚饭这一步进行到哪里了？",
      "options": [
        {"id":"finished","label":"已经吃完","reply":"晚饭已经记录。现在方便准备洗澡了吗？","next":"@dinner"},
        {"id":"eating","label":"正在吃","reply":"安心吃饭，吃完再确认。","next":"dinnerEating"},
        {"id":"pending","label":"还没开始","reply":"先把手头的事停在一个方便继续的位置。","next":"dinnerWrap","guide":true}
      ]
    },
    "dinnerEating": {
      "question": "吃完再确认就好。",
      "options": [
        {"id":"finished","label":"已经吃完","reply":"晚饭已经记录。现在方便准备洗澡了吗？","next":"@dinner"},
        {"id":"eating","label":"还在吃","reply":"先安心吃饭。","next":"dinnerEating"}
      ]
    },
    "dinnerReady": {
      "question": "晚饭这一步进行到哪里了？",
      "options": [
        {"id":"eating","label":"已经开始吃饭","reply":"安心吃饭，吃完再确认。","next":"dinnerEating"},
        {"id":"finished","label":"已经吃完","reply":"晚饭已经记录。现在方便准备洗澡了吗？","next":"@dinner"},
        {"id":"stuck","label":"还没能出发或开始","reply":"可以先记下手头事情的下一步，再准备晚饭。","next":"dinnerStart","guide":true}
      ]
    },
    "dinnerBusy": {
      "question": "现在是什么情况？",
      "options": [
        {"id":"working","label":"还在工作，需要收尾","reply":"先保存进度，约个收尾时间。","next":"@wait:dinnerWrap"},
        {"id":"plans","label":"有其他安排或暂时不适合","reply":"按你的安排，约个合适时间。","next":"@wait:dinnerStart"},
        {"id":"now","label":"现在可以去吃","reply":"去准备晚饭吧。","next":"dinnerStart"}
      ]
    },
    "dinnerWrap": {
      "question": "手头事情收尾了吗？",
      "options": [
        {"id":"done","label":"已经收尾","reply":"可以准备吃饭了。","next":"dinnerStart"},
        {"id":"stuck","label":"还是没能收尾","reply":"先把未完成的下一步记一行。","next":"dinnerWrap","guide":true}
      ]
    },
    "bathBusy": {
      "question": "现在是什么让你还不能开始？",
      "options": [
        {"id":"outside","label":"还没到家","reply":"可以约到家后再确认。","next":"@wait:bathSwitch"},
        {"id":"busy","label":"正在处理其他事情","reply":"先找一个可以暂停的节点。","next":"bathSwitch","guide":true},
        {"id":"ready","label":"现在可以去了","reply":"带好换洗衣物，需要的话先开启计时。","next":"bathTimer"}
      ]
    },
    "bathSwitch": {
      "question": "现在可以去洗澡了吗？",
      "options": [
        {"id":"ready","label":"现在可以去","reply":"带好换洗衣物，需要的话先开启计时。","next":"bathTimer"},
        {"id":"busy","label":"还是不能去","reply":"先给手头的事找个可以暂停的节点。","next":"bathSwitch","guide":true}
      ]
    },
    "bathTimer": {
      "question": "如果需要计时，选好模式再开始。",
      "options": [
        {"id":"no_timer","label":"不计时，直接开始","reply":"按自己的节奏完成，结束后再确认。","next":"bathResult"},
        {"id":"finished","label":"已经全部完成","reply":"清清爽爽地回来啦！今天的洗浴任务完成了。","next":"@bath"}
      ]
    },
    "bathResult": {
      "question": "洗澡及计划内整理完成了吗？",
      "options": [
        {"id":"finished","label":"已经全部完成","reply":"清清爽爽地回来啦！今天的洗浴任务完成了。","next":"@bath"},
        {"id":"doing","label":"还在进行","reply":"先完成手头这一步。","next":"bathResult"},
        {"id":"stuck","label":"中途卡住了","reply":"先只确认还有哪一步没完成。","next":"@barrier:bathResult","guide":true}
      ]
    },
    "sleepBarrier": {
      "question": "现在主要是什么让你难以收尾？",
      "options": [
        {"id":"awake","label":"还不困","reply":"可以先把灯光调暗，做一点安静的睡前准备。","next":"bedtime","guide":true},
        {"id":"thoughts","label":"想法多或情绪影响","reply":"可以只记下最挂念的一句话。","next":"bedtime","guide":true},
        {"id":"stop","label":"舍不得结束今天或停不下娱乐","reply":"先给手头这件事找一个可以停下来的位置。","next":"bedtime","guide":true}
      ]
    },
    "sleepInBed": {
      "question": "现在准备放下手机休息了吗？",
      "options": [
        {"id":"sleep","label":"准备放下手机睡觉","reply":"晚安。你可以安心休息了。","next":"@bed"},
        {"id":"stuck","label":"脑子里还有事情或还停不下来","reply":"不用起来，先把最挂念的一句话暂存。","next":"sleepInBed","guide":true},
        {"id":"skip","label":"今晚直接休息，跳过复盘","reply":"今晚可以直接休息。","next":"@bedSkip"}
      ]
    },
    "sleepReady": {
      "question": "接下来想怎么安排？",
      "options": [
        {"id":"review","label":"开始简短复盘和明日计划","reply":"简单说说今天的进展或明天的重点。","next":"@review"},
        {"id":"ready","label":"已经整理好，准备上床","reply":"可以按自己的节奏去休息。","next":"bedtime"},
        {"id":"skip","label":"今晚不复盘","reply":"今晚略过复盘。准备好休息时再确认。","next":"@skipReview"}
      ]
    },
    "sleepBusy": {
      "question": "现在主要在做什么？",
      "options": [
        {"id":"work","label":"还在工作","reply":"保存当前进度，记下下次的第一步。","next":"bedtime"},
        {"id":"fun","label":"还在娱乐","reply":"把进度停在可继续的位置，退出页面。","next":"bedtime"},
        {"id":"necessary","label":"其他必要事务","reply":"先完成必要事务，方便时再开始收尾。","next":"bedtime"}
      ]
    },
    "bedtime": {
      "question": "睡前准备到哪一步了？",
      "options": [
        {"id":"bed","label":"已上床，准备休息","reply":"晚安，把剩下的事交给明天。","next":"@bed"},
        {"id":"doing","label":"还在收尾","reply":"接下来只做一个必要步骤。","next":"bedtime"},
        {"id":"stuck","label":"收尾有困难","reply":"先把最挂念的一句话记下来。","next":"bedtime","guide":true}
      ]
    },
    "wait": {
      "question": "现在进展怎么样？",
      "options": [
        {"id":"done","label":"已结束，可以继续","reply":"我们继续刚才那一步。","next":"@resume"},
        {"id":"doing","label":"仍在进行","reply":"需要的话，可以重新约定时间。","next":"@stayWait"},
        {"id":"adjust","label":"需要调整计划","reply":"可以直接说你想怎么调整，由你确认。","next":"@stayWait"}
      ]
    },
    "customHelp": {
      "question": "这个小步骤进展怎么样？",
      "options": [
        {"id":"finished","label":"已经完成","reply":"收到，已记录这次完成。","next":"@customComplete"},
        {"id":"doing","label":"正在进行","reply":"先继续手头这一步。","next":"@customDoing"},
        {"id":"stuck","label":"还是没开始","reply":"先试一个动作：{firstStep}","next":"customBarriers","guide":true}
      ]
    },
    "customBarriers": {
      "question":"是什么让这一步难开始？",
      "options":[
        {"id":"unclear","label":"不知道怎么做","reply":"先把你不确定的那一步写下来，接着试这个动作：{firstStep}","next":"@barrier:customHelp","guide":true},
        {"id":"distracted","label":"被别的事打断","reply":"把手边的事记一行，腾出一分钟给「{task}」。","next":"@barrier:customHelp","guide":true},
        {"id":"low_energy","label":"状态不太好","reply":"可以先喝口水，再决定做一个小动作还是暂停。","next":"@barrier:customHelp","guide":true}
      ]
    }
  },
  "customOptions": [
    {"id":"finished","label":"已经完成","reply":"收到，已记录这次完成。","next":"@customComplete"},
    {"id":"doing","label":"正在进行","reply":"先继续手头这一步，方便时再回来确认。","next":"@customDoing"},
    {"id":"help","label":"还没开始","reply":"现在只做这一步：{firstStep}","next":"customHelp"},
    {"id":"difficulty","label":"遇到困难","reply":"我们先看看是什么让「{task}」难开始。","next":"customBarriers"}
  ]
});
