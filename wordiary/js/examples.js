/* The user's own tutoring exchanges, rewritten into the reply schema. They set the tone and the order of information:
   closest fix first, then a more natural version, Korean meaning, expression points, other ways to say it, a bonus, and a pick. */
export const EXAMPLES = [
  {
    context: [],
    input: "It's such a nostalgic to visit my uni",
    reply: {
      closest: "It's so nostalgic to visit my uni again! 🥹",
      natural: "Visiting my uni again brings back so many memories!",
      meaningKo: "모교에 다시 오니까 추억이 정말 많이 떠올라!",
      points: [
        { en: "so nostalgic", ko: "정말 향수를 불러일으키는", note: "nostalgic은 형용사라서 a nostalgic이라고 쓰지 않아." },
        { en: "brings back so many memories", ko: "추억이 정말 많이 떠올라" },
      ],
      alternatives: [],
      bonus: null,
      recommend: "natural",
      recommendWhy: "오랜만에 모교를 방문한 감정을 표현한다면 두 번째가 특히 자연스러워! ☀️",
      covered: ["모교 방문", "향수/그리움"],
      assumed: "",
      scene: "a university gate with a heart-shaped memory bubble",
    },
  },
  {
    context: [{ input: "It's such a nostalgic to visit my uni", sent: "Visiting my uni again brings back so many memories!" }],
    input: "Yeah right it's a in front of the view of my uni. My uni is close to 북한산 and it has a beautiful scene I love autumn view esp",
    reply: {
      closest: "Yeah, right! It's right in front of the view of my uni. My uni is close to Bukhansan, so it has such beautiful scenery. I especially love the autumn views! 🍂",
      natural: "Yeah, right! This is the view right in front of my uni. It's close to Bukhansan, so the scenery is beautiful. I especially love how it looks in autumn! 🥹",
      meaningKo: "맞아! 이게 우리 학교 바로 앞 풍경이야. 북한산이랑 가까워서 경치가 정말 예뻐. 특히 가을 풍경을 제일 좋아해!",
      points: [
        { en: "the view right in front of my uni", ko: "우리 학교 바로 앞에 펼쳐지는 풍경" },
        { en: "beautiful scenery", ko: "아름다운 경치" },
        { en: "I especially love how it looks in autumn", ko: "특히 가을에 보이는 모습이 정말 좋아" },
        { en: "esp.", ko: "especially의 줄임말", note: "일상 메시지에서는 그냥 especially라고 써도 자연스러워." },
      ],
      alternatives: [],
      bonus: null,
      recommend: "natural",
      recommendWhy: "두 번째 버전 추천! 사진과 함께 보내기 딱 좋아. ☀️",
      covered: ["맞장구", "학교 앞 풍경", "북한산 근처", "아름다운 경치", "특히 가을 풍경을 좋아함"],
      assumed: "",
      scene: "a mountain with autumn leaves behind a small campus building",
    },
  },
  {
    context: [{ input: "(earlier) they were talking about having strange, vivid dreams", sent: "" }],
    input: "I think it relates to how I'm thinking a lot and",
    reply: {
      closest: "I think it has something to do with how much I think about things.",
      natural: "",
      meaningKo: "내가 평소에 생각을 많이 하는 것과 관련이 있는 것 같아.",
      points: [
        { en: "has something to do with", ko: "~와 관련이 있다", note: "relates to보다 대화에서 훨씬 자연스러워." },
      ],
      alternatives: [
        { en: "I think it's related to how much I tend to overthink things.", ko: "내가 이것저것 많이 생각하는 성향과 관련 있는 것 같아." },
        { en: "I guess my dreams reflect how active my imagination is.", ko: "내 꿈이 내 상상력이 얼마나 활발한지를 반영하는 것 같아." },
      ],
      bonus: null,
      recommend: "closest",
      recommendWhy: "여기서는 how much I think about things가 가장 자연스럽고 편안한 표현이야! 😊",
      covered: ["관련이 있는 것 같음", "생각을 많이 함"],
      assumed: "문장이 'and'에서 끊겨서, 생각을 많이 하는 것까지만 담았어.",
      scene: "a head with swirling thought lines and a small cloud",
    },
  },
  {
    context: [{ input: "I think it relates to how I'm thinking a lot and", sent: "I think it has something to do with how much I think about things." }],
    input: "Same here and i found very interesting thing that my dream is also more imaginative than others",
    reply: {
      closest: "Same here! And I've noticed something really interesting: my dreams are also way more imaginative than other people's. 🤣",
      natural: "Same here! I've actually noticed that my dreams tend to be much more vivid and imaginative than other people's.",
      meaningKo: "나도 그래! 그리고 신기한 걸 발견했는데, 내 꿈이 다른 사람들 꿈보다 훨씬 상상력이 풍부하더라.",
      points: [
        { en: "I've noticed", ko: "알아차렸어 / 발견했어", note: "I found보다 이 문맥에 자연스러워." },
        { en: "my dreams", ko: "내가 꾸는 꿈들" },
        { en: "way more imaginative than other people's", ko: "다른 사람들의 꿈보다 훨씬 더 상상력이 풍부한" },
      ],
      alternatives: [],
      bonus: { en: "vivid dreams", ko: "생생하고 현실처럼 느껴지는 꿈" },
      recommend: "natural",
      recommendWhy: "조금 더 신기해하는 느낌으로는 두 번째가 좋아. ☀️",
      covered: ["나도 그래", "흥미로운 걸 발견함", "내 꿈이 남들보다 상상력이 풍부함"],
      assumed: "",
      scene: "a sleeping face under a big dream cloud with a star and a moon",
    },
  },
];
