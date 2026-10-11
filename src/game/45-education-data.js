// =============================================================================
// 45-education-data.js — education contents, quizzes, exhibit cards, hall guide.
//
// PURE DATA: no THREE / DOM access. tools/build.mjs also evaluates this file in Node
// to export quiz rewards for the PHP server (server/data/game-data.json).
//
// Facts are short, general, widely accepted summaries written for teens/adults.
// They are NOT expert-reviewed: every content carries `source` + `verified:false`
// (spec #72: Source / Author / ReferenceDate / EducationalCategory).
//
// Page visual types (rendered by 46-education.js):
//   { type:'model', model:'jar'|'meju'|'bean'|'pepper'|'cabbage'|'kimchi'|'jige'|'maetdol'|'tools'|'soy'|
//                   'doenjang'|'gochujang'|'vinegar'|'season', opts?:{lidOpen:true}, caption? }
//   { type:'emoji', emoji:'🏺', caption? }
//   { type:'svg', svg:'<svg ...>', caption? }
//   { type:'steps', items:[{icon, label, sep?}], sep:'→', caption? }   (flow / icon row)
// =============================================================================

(function () {
  const SRC = '일반 상식 요약(교육용) — 전문 감수 필요';
  const AUTHOR = '전통발효체험관 교육 콘텐츠(게임용 요약)';
  const REF_DATE = '2026-10';

  G.data.educationCategories = {
    ferment: { name: '발효 기초', color: '#e0a35a', icon: '🧫' },
    onggi: { name: '옹기·장독대', color: '#b5774a', icon: '🏺' },
    jang: { name: '장 담그기', color: '#c9925a', icon: '🫘' },
    kimchi: { name: '김치', color: '#e2574c', icon: '🥬' },
    farming: { name: '전통농업', color: '#7fbf5a', icon: '🌾' },
    tools: { name: '전통도구', color: '#6fb6e8', icon: '🛠️' },
  };

  // ---------------------------------------------------------------- inline illustrations (viewBox 320x240)
  const FONT = "font-family=\"PretendardEmbed,Pretendard,'Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',sans-serif\"";
  const SVG = {
    microbes: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><radialGradient id="emg" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#fffdf6"/><stop offset="1" stop-color="#efdcb8"/></radialGradient></defs>
<path d="M196 166 L250 220" stroke="#5a3a22" stroke-width="20" stroke-linecap="round"/>
<path d="M196 166 L250 220" stroke="#8a5a3b" stroke-width="12" stroke-linecap="round"/>
<circle cx="138" cy="108" r="88" fill="url(#emg)" stroke="#6b4a2b" stroke-width="11"/>
<circle cx="138" cy="108" r="80" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-dasharray="60 400" transform="rotate(200 138 108)"/>
<g fill="#86cf7c" stroke="#3f8a3a" stroke-width="2.5">
<rect x="78" y="62" width="46" height="17" rx="8.5" transform="rotate(-22 101 70)"/>
<rect x="150" y="138" width="42" height="16" rx="8" transform="rotate(24 171 146)"/>
<rect x="96" y="146" width="36" height="15" rx="7.5" transform="rotate(-6 114 153)"/>
</g>
<g fill="#2b2118"><circle cx="96" cy="69" r="2"/><circle cx="106" cy="66" r="2"/><circle cx="165" cy="143" r="2"/><circle cx="175" cy="147" r="2"/><circle cx="109" cy="151" r="1.8"/><circle cx="118" cy="151" r="1.8"/></g>
<g fill="#f6c453" stroke="#b9860f" stroke-width="2.5"><circle cx="176" cy="80" r="18"/><circle cx="196" cy="64" r="9"/><circle cx="92" cy="114" r="13"/></g>
<g fill="#2b2118"><circle cx="170" cy="78" r="2.2"/><circle cx="181" cy="78" r="2.2"/><circle cx="88" cy="112" r="1.8"/><circle cx="96" cy="112" r="1.8"/></g>
<path d="M170 86q5.5 4 11 0" fill="none" stroke="#2b2118" stroke-width="1.8" stroke-linecap="round"/>
<g fill="none" stroke="#9b86d6" stroke-width="3.2" stroke-linecap="round"><path d="M122 116c10-15 22-13 30-3s20 10 27 0"/><path d="M140 108c-3-12 5-19 12-23"/><path d="M152 113c3 10 0 18-6 24"/></g>
<g fill="#b5a2ee" stroke="#7d68c2" stroke-width="2"><circle cx="153" cy="84" r="6"/><circle cx="180" cy="113" r="6"/><circle cx="145" cy="138" r="5"/></g>
<g ${FONT} font-size="13" font-weight="700">
<rect x="236" y="34" width="66" height="26" rx="13" fill="#f6c453"/><text x="269" y="52" text-anchor="middle" fill="#4a3300">효모</text>
<rect x="236" y="72" width="66" height="26" rx="13" fill="#86cf7c"/><text x="269" y="90" text-anchor="middle" fill="#163d14">세균</text>
<rect x="236" y="110" width="66" height="26" rx="13" fill="#b5a2ee"/><text x="269" y="128" text-anchor="middle" fill="#2e1f63">곰팡이</text>
</g>
<text x="14" y="228" font-size="12.5" fill="#6b4a2b" font-weight="600">눈에 보이지 않을 만큼 작은 미생물이 발효를 일으켜요</text>
</svg>`,

    fermentVsRot: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<rect x="10" y="22" width="138" height="170" rx="18" fill="#e9f6e2" stroke="#7cc576" stroke-width="3"/>
<rect x="172" y="22" width="138" height="170" rx="18" fill="#f6e6e3" stroke="#e08a80" stroke-width="3"/>
<ellipse cx="79" cy="66" rx="30" ry="7" fill="#3b2416"/>
<path d="M50 70c-14 18-12 62 6 84h46c18-22 20-66 6-84z" fill="#6b4126"/>
<path d="M54 98h50" stroke="#e7c27a" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="68" cy="118" rx="6" ry="16" fill="#fff" opacity=".18"/>
<circle cx="120" cy="56" r="17" fill="#34c36b"/><path d="m112 56 6 6 11-12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<text x="79" y="178" text-anchor="middle" font-size="17" font-weight="800" fill="#1f6e3a">발효</text>
<path d="M200 128c0-22 18-36 41-36s41 14 41 36v26h-82z" fill="#e2b46c"/>
<path d="M200 128c0-22 18-36 41-36s41 14 41 36" fill="none" stroke="#b9853b" stroke-width="3"/>
<g fill="#7d8b6a" opacity=".9"><circle cx="222" cy="120" r="9"/><circle cx="252" cy="136" r="12"/><circle cx="270" cy="114" r="7"/><circle cx="236" cy="146" r="6"/></g>
<g fill="#a7b48f"><circle cx="219" cy="117" r="3"/><circle cx="248" cy="132" r="4"/></g>
<circle cx="282" cy="56" r="17" fill="#ff6b5e"/><path d="m275 49 14 14m0-14-14 14" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
<text x="241" y="178" text-anchor="middle" font-size="17" font-weight="800" fill="#a23a30">부패</text>
<text x="160" y="214" text-anchor="middle" font-size="12.5" font-weight="600" fill="#5a4636">둘 다 미생물의 작용 · 먹기 좋게 변하면 발효, 상하면 부패</text>
</svg>`,

    agingTimeline: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<path d="M26 70 Q160 -6 294 70" fill="none" stroke="#e7c27a" stroke-width="3" stroke-dasharray="6 7"/>
<circle cx="70" cy="44" r="13" fill="#f6c453"/><g stroke="#f6c453" stroke-width="3" stroke-linecap="round"><path d="M70 22v-6M70 72v-4M48 44h-6M98 44h-6"/></g>
<path d="M258 32a15 15 0 1 0 14 22 12 12 0 0 1-14-22z" fill="#c9d4f2"/>
<g transform="translate(0 6)">
<g transform="translate(40 96)"><ellipse cx="22" cy="6" rx="16" ry="4" fill="#3b2416"/><path d="M6 8c-9 12-8 40 4 54h24c12-14 13-42 4-54z" fill="#7a4a2c"/><rect x="9" y="38" width="26" height="22" rx="6" fill="#c9a46a"/></g>
<g transform="translate(110 92)"><ellipse cx="22" cy="6" rx="17" ry="4" fill="#3b2416"/><path d="M5 8c-9 13-8 44 4 58h26c12-14 13-45 4-58z" fill="#6f4227"/><rect x="8" y="34" width="28" height="30" rx="7" fill="#a87a45"/></g>
<g transform="translate(180 88)"><ellipse cx="23" cy="6" rx="18" ry="4.5" fill="#3b2416"/><path d="M5 9c-10 14-9 47 4 62h28c13-15 14-48 4-62z" fill="#653a22"/><rect x="8" y="30" width="30" height="38" rx="8" fill="#7d5530"/></g>
<g transform="translate(250 84)"><ellipse cx="23" cy="6" rx="19" ry="4.5" fill="#3b2416"/><path d="M4 9c-10 15-9 51 5 66h29c14-15 15-51 5-66z" fill="#5a321d"/><rect x="7" y="26" width="32" height="46" rx="9" fill="#4e3218"/></g>
</g>
<path d="M30 196h260" stroke="#b08a5a" stroke-width="3" stroke-linecap="round"/><path d="m282 189 10 7-10 7" fill="none" stroke="#b08a5a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<g font-size="13" font-weight="700" fill="#5a3a22" text-anchor="middle"><text x="62" y="186">며칠</text><text x="132" y="186">몇 주</text><text x="203" y="186">몇 달</text><text x="273" y="186">몇 년</text></g>
<text x="160" y="224" text-anchor="middle" font-size="12.5" font-weight="600" fill="#6b4a2b">시간이 흐를수록 색은 짙어지고 맛은 깊어져요</text>
</svg>`,

    jangdokdae: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><linearGradient id="ejs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3ff"/><stop offset="1" stop-color="#fff4dc"/></linearGradient><linearGradient id="ejj" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7a4628"/><stop offset=".45" stop-color="#5a321d"/><stop offset="1" stop-color="#3b2214"/></linearGradient></defs>
<rect width="320" height="240" rx="18" fill="url(#ejs)"/>
<circle cx="268" cy="44" r="20" fill="#ffd766"/><circle cx="268" cy="44" r="30" fill="#ffd766" opacity=".25"/>
<path d="M0 120 L60 70 L110 104 L170 58 L240 108 L320 80 V150 H0z" fill="#8fbf7a"/>
<path d="M0 138 L80 104 L150 132 L230 98 L320 126 V160 H0z" fill="#6aa65a"/>
<rect x="18" y="176" width="284" height="40" rx="6" fill="#b9b1a3"/>
<g fill="#a69d8e" stroke="#8d8578" stroke-width="1.5"><rect x="22" y="182" width="44" height="14" rx="4"/><rect x="70" y="182" width="52" height="14" rx="4"/><rect x="126" y="182" width="40" height="14" rx="4"/><rect x="170" y="182" width="56" height="14" rx="4"/><rect x="230" y="182" width="68" height="14" rx="4"/><rect x="22" y="199" width="60" height="13" rx="4"/><rect x="86" y="199" width="44" height="13" rx="4"/><rect x="134" y="199" width="58" height="13" rx="4"/><rect x="196" y="199" width="46" height="13" rx="4"/><rect x="246" y="199" width="52" height="13" rx="4"/></g>
<rect x="40" y="150" width="240" height="28" rx="5" fill="#cbc3b4"/>
<g>
<g transform="translate(50 108)"><path d="M6 12c-10 12-9 34 5 44h26c14-10 15-32 5-44z" fill="url(#ejj)"/><ellipse cx="24" cy="10" rx="18" ry="5" fill="#2e1a10"/><ellipse cx="24" cy="7" rx="14" ry="5" fill="#4a2a18"/></g>
<g transform="translate(104 98)"><path d="M6 14c-12 14-11 40 6 52h30c17-12 18-38 6-52z" fill="url(#ejj)"/><ellipse cx="27" cy="12" rx="21" ry="6" fill="#2e1a10"/><ellipse cx="27" cy="8" rx="16" ry="6" fill="#4a2a18"/></g>
<g transform="translate(164 104)"><path d="M6 13c-11 13-10 37 5 48h28c15-11 16-35 5-48z" fill="url(#ejj)"/><ellipse cx="25" cy="11" rx="19" ry="5.5" fill="#2e1a10"/><ellipse cx="25" cy="8" rx="15" ry="5" fill="#4a2a18"/></g>
<g transform="translate(220 114)"><path d="M5 10c-8 10-7 28 4 37h22c11-9 12-27 4-37z" fill="url(#ejj)"/><ellipse cx="20" cy="9" rx="15" ry="4.5" fill="#2e1a10"/><ellipse cx="20" cy="6" rx="12" ry="4" fill="#4a2a18"/></g>
</g>
<g fill="#fff" opacity=".22"><ellipse cx="62" cy="134" rx="4" ry="11"/><ellipse cx="119" cy="128" rx="5" ry="14"/><ellipse cx="178" cy="131" rx="4" ry="12"/><ellipse cx="231" cy="136" rx="3" ry="9"/></g>
<g stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity=".85" fill="none"><path d="M18 74c14-6 22 6 36 0"/><path d="M30 92c14-6 22 6 36 0"/></g>
<text x="160" y="232" text-anchor="middle" font-size="12" font-weight="700" fill="#5a3a22">햇볕 잘 들고 바람 잘 통하는 높은 돌단 위</text>
</svg>`,

    jarTypes: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><linearGradient id="ejt" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5432"/><stop offset=".5" stop-color="#5e3520"/><stop offset="1" stop-color="#3d2215"/></linearGradient></defs>
<path d="M14 196h292" stroke="#c7b08a" stroke-width="3" stroke-linecap="round"/>
<g transform="translate(18 38)"><ellipse cx="34" cy="8" rx="22" ry="5" fill="#2e1a10"/><path d="M14 10c-14 22-12 120 4 148h32c16-28 18-126 4-148z" fill="url(#ejt)"/><path d="M12 58h44" stroke="#c9a46a" stroke-width="2" opacity=".7"/><ellipse cx="26" cy="90" rx="5" ry="26" fill="#fff" opacity=".14"/></g>
<g transform="translate(96 84)"><ellipse cx="34" cy="8" rx="20" ry="5" fill="#2e1a10"/><path d="M15 10c-22 22-22 76 4 102h30c26-26 26-80 4-102z" fill="url(#ejt)"/><path d="M8 50h52" stroke="#c9a46a" stroke-width="2" opacity=".7"/><ellipse cx="24" cy="62" rx="5" ry="20" fill="#fff" opacity=".14"/></g>
<g transform="translate(176 92)"><ellipse cx="34" cy="7" rx="12" ry="4" fill="#2e1a10"/><path d="M23 9c0 6-2 8-8 14-22 20-18 64 6 80h26c24-16 28-60 6-80-6-6-8-8-8-14z" fill="url(#ejt)"/><path d="M8 52h52" stroke="#c9a46a" stroke-width="2" opacity=".7"/><ellipse cx="24" cy="58" rx="5" ry="18" fill="#fff" opacity=".14"/></g>
<g transform="translate(252 134)"><ellipse cx="25" cy="7" rx="15" ry="4" fill="#2e1a10"/><path d="M11 9c-14 12-14 40 2 52h24c16-12 16-40 2-52z" fill="url(#ejt)"/><ellipse cx="18" cy="32" rx="4" ry="11" fill="#fff" opacity=".14"/></g>
<g font-size="15" font-weight="800" fill="#4a2c18" text-anchor="middle"><text x="52" y="218">독</text><text x="130" y="218">중두리</text><text x="210" y="218">항아리</text><text x="277" y="218">단지</text></g>
<g font-size="10.5" font-weight="600" fill="#8a6a4a" text-anchor="middle"><text x="52" y="233">가장 큰 그릇</text><text x="130" y="233">배가 부른 중간 크기</text><text x="210" y="233">좁은 아가리</text><text x="277" y="233">작고 목이 짧음</text></g>
</svg>`,

    beanCycle: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<rect x="0" y="150" width="320" height="58" rx="12" fill="#8a5a3b"/><rect x="0" y="150" width="320" height="10" rx="5" fill="#a8774f"/>
<g fill="#6b4126"><circle cx="30" cy="180" r="3"/><circle cx="110" cy="190" r="2.5"/><circle cx="200" cy="178" r="3"/><circle cx="270" cy="194" r="2.5"/></g>
<ellipse cx="42" cy="150" rx="12" ry="9" fill="#e7c98a" stroke="#b58f4a" stroke-width="2"/><path d="M36 147q6 4 12 0" stroke="#b58f4a" stroke-width="1.6" fill="none"/>
<path d="M118 152v-28" stroke="#5f9e3a" stroke-width="4" stroke-linecap="round"/><ellipse cx="108" cy="122" rx="12" ry="7" fill="#7fc25a" transform="rotate(-25 108 122)"/><ellipse cx="128" cy="122" rx="12" ry="7" fill="#7fc25a" transform="rotate(25 128 122)"/>
<path d="M196 152c0-30 2-56-2-80" stroke="#4f8f32" stroke-width="4.5" fill="none" stroke-linecap="round"/>
<g fill="#6aa84f"><ellipse cx="176" cy="104" rx="15" ry="8" transform="rotate(-30 176 104)"/><ellipse cx="214" cy="96" rx="15" ry="8" transform="rotate(28 214 96)"/><ellipse cx="190" cy="76" rx="13" ry="7" transform="rotate(-60 190 76)"/><ellipse cx="208" cy="124" rx="14" ry="7.5" transform="rotate(20 208 124)"/></g>
<g fill="#b78be0"><circle cx="198" cy="88" r="4.5"/><circle cx="186" cy="118" r="4"/><circle cx="203" cy="108" r="3.6"/></g>
<path d="M272 152c0-30 2-58-2-84" stroke="#7d8f3a" stroke-width="4.5" fill="none" stroke-linecap="round"/>
<g fill="#a6b05a"><ellipse cx="252" cy="96" rx="15" ry="8" transform="rotate(-30 252 96)"/><ellipse cx="290" cy="90" rx="15" ry="8" transform="rotate(28 290 90)"/><ellipse cx="282" cy="120" rx="14" ry="7.5" transform="rotate(20 282 120)"/></g>
<g fill="#c9a85a" stroke="#8f7434" stroke-width="1.5"><rect x="256" y="104" width="10" height="28" rx="5" transform="rotate(14 261 118)"/><rect x="276" y="98" width="10" height="30" rx="5" transform="rotate(-12 281 113)"/><rect x="264" y="126" width="9" height="24" rx="4.5" transform="rotate(30 268 138)"/></g>
<g fill="none" stroke="#c7b08a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M64 140h22m-6-5 6 5-6 5"/><path d="M144 132h22m-6-5 6 5-6 5"/><path d="M226 128h20m-6-5 6 5-6 5"/></g>
<g font-size="12.5" font-weight="800" fill="#fff" text-anchor="middle"><text x="42" y="182">봄</text><text x="118" y="182">싹 트기</text><text x="196" y="182">여름 꽃</text><text x="272" y="182">가을 꼬투리</text></g>
<text x="160" y="228" text-anchor="middle" font-size="12" font-weight="600" fill="#5a4636">씨앗 → 싹 → 꽃 → 꼬투리, 콩의 한살이</text>
</svg>`,

    kimchiBuried: `<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg" ${FONT}>
<defs><linearGradient id="ekb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dbe9f7"/><stop offset="1" stop-color="#f6f9ff"/></linearGradient><linearGradient id="eks" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9a6a45"/><stop offset="1" stop-color="#5a3a22"/></linearGradient></defs>
<rect width="320" height="240" rx="18" fill="url(#ekb)"/>
<g fill="#fff"><circle cx="40" cy="30" r="3"/><circle cx="90" cy="54" r="2.5"/><circle cx="150" cy="24" r="3"/><circle cx="214" cy="46" r="2.5"/><circle cx="276" cy="28" r="3"/><circle cx="300" cy="64" r="2"/><circle cx="24" cy="70" r="2"/></g>
<path d="M0 100h320v130a10 10 0 0 1-10 10H10a10 10 0 0 1-10-10z" fill="url(#eks)"/>
<path d="M0 100h320v8H0z" fill="#ffffff"/><path d="M0 108c40 6 80-4 120 2s90 4 130-2 50 2 70 0v4H0z" fill="#e9eef5"/>
<path d="M130 70 L160 42 L190 70z" fill="#d9b45a" stroke="#a8862f" stroke-width="2"/><path d="M134 70h52v32h-52z" fill="#c9a24a" opacity=".55"/>
<g transform="translate(116 104)"><ellipse cx="44" cy="8" rx="30" ry="7" fill="#2e1a10"/><path d="M14 10c-20 26-18 84 10 104h40c28-20 30-78 10-104z" fill="#6b4126"/><path d="M16 48h56" stroke="#c9a46a" stroke-width="2.5" opacity=".7"/><ellipse cx="30" cy="68" rx="6" ry="22" fill="#fff" opacity=".15"/></g>
<g transform="translate(250 130)"><rect x="0" y="0" width="14" height="66" rx="7" fill="#fff" stroke="#9fb4c8" stroke-width="2"/><circle cx="7" cy="72" r="11" fill="#4aa8ff" stroke="#9fb4c8" stroke-width="2"/><rect x="4" y="34" width="6" height="36" rx="3" fill="#4aa8ff"/></g>
<text x="246" y="122" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">서늘하고 고르게</text>
<text x="40" y="150" font-size="12.5" font-weight="700" fill="#fff">땅속</text>
<text x="160" y="232" text-anchor="middle" font-size="12" font-weight="600" fill="#f4e6d2">겨울엔 김칫독을 땅에 묻어 온도를 고르게 지켰어요</text>
</svg>`,
  };

  // ---------------------------------------------------------------- contents
  G.data.education = {
    EDU_FERMENT: {
      title: '전통발효란?', cat: 'ferment', category: '발효 기초', icon: '🧫',
      summary: '눈에 보이지 않는 작은 생물, 미생물이 음식을 새로운 맛과 향으로 바꾸는 과정을 알아봐요.',
      pages: [
        {
          title: '발효는 무엇일까요?',
          text: '발효는 효모·곰팡이·세균 같은 미생물이 음식 속 성분을 분해하고 바꾸면서 새로운 맛과 향을 만들어 내는 과정이에요. 같은 콩이라도 발효를 거치면 구수한 된장이 되고, 곡물은 술과 식초로 변하지요.',
          points: ['미생물: 눈으로는 볼 수 없을 만큼 아주 작은 생물', '성분이 분해·변화하면서 맛·향·식감이 달라져요'],
          visual: { type: 'svg', svg: SVG.microbes },
        },
        {
          title: '발효와 부패는 어떻게 다를까요?',
          text: '발효와 부패는 모두 미생물이 일으키는 변화예요. 사람에게 이롭고 먹기 좋은 쪽으로 변하면 발효, 먹을 수 없게 상하면 부패라고 구분해요. 그래서 발효 음식을 만들 때는 알맞은 소금의 양, 온도, 그리고 깨끗함을 잘 지키는 것이 중요해요.',
          points: ['소금·온도·청결 관리가 발효의 핵심', '이로운 미생물이 잘 자라는 환경을 만들어 주기'],
          visual: { type: 'svg', svg: SVG.fermentVsRot },
        },
        {
          title: '우리나라의 발효 음식',
          text: '우리 조상들은 된장·간장·고추장 같은 장류를 비롯해 김치, 젓갈, 식초, 막걸리처럼 다양한 발효 음식을 만들어 왔어요. 제철 재료를 오래 저장하고 맛을 깊게 하는 생활의 지혜가 담겨 있지요.',
          points: ['장류 · 김치 · 젓갈 · 식초 · 전통주', '장독대는 이런 발효 음식을 보관하던 곳이에요'],
          visual: { type: 'model', model: 'jar', caption: '장을 담그는 옹기 항아리' },
        },
        {
          title: '기다림의 음식',
          text: '발효 음식은 짧게는 며칠, 길게는 몇 년에 걸쳐 천천히 익어 가요. 시간이 지나며 맛이 깊어지기 때문에 ‘기다림의 음식’이라고도 불러요. 게임 속 장독대에서는 이 긴 과정을 짧게 줄여서 체험해 볼 수 있어요.',
          points: ['게임 속 발효 시간과 수치는 교육용 가상 시뮬레이션이에요'],
          visual: { type: 'svg', svg: SVG.agingTimeline },
        },
      ],
      quiz: 'QZ_FERMENT_1', quizzes: ['QZ_FERMENT_1', 'QZ_FERMENT_2', 'QZ_FERMENT_3'],
      related: ['EDU_JANGDOK', 'EDU_KIMCHI'],
    },

    EDU_JANGDOK: {
      title: '장독대와 옹기', cat: 'onggi', category: '옹기·장독대', icon: '🏺',
      summary: '장을 품어 익히는 장독대, 그리고 ‘숨 쉬는 그릇’이라 불리는 옹기 이야기를 들어 봐요.',
      pages: [
        {
          title: '장독대는 어떤 곳일까요?',
          text: '장독대는 된장·간장·고추장 같은 장을 담은 독과 항아리를 모아 두는 곳이에요. 보통 집 뒤뜰이나 마당 한쪽, 햇볕이 잘 들고 바람이 잘 통하는 자리에 돌을 쌓아 땅보다 조금 높게 만들었어요.',
          points: ['햇볕과 바람이 잘 드는 곳', '빗물이 고이지 않도록 돌로 높게 쌓은 단'],
          visual: { type: 'svg', svg: SVG.jangdokdae },
        },
        {
          title: '숨 쉬는 그릇, 옹기',
          text: '옹기는 흙으로 빚어 높은 온도의 가마에서 구운 그릇이에요. 그릇 벽에 아주 미세한 숨구멍이 있어 공기가 조금씩 드나들기 때문에 ‘숨 쉬는 그릇’이라고 불려요. 이런 특징 덕분에 장을 오래 두고 익히기에 알맞다고 알려져 있어요.',
          points: ['흙으로 빚어 구운 그릇', '미세한 숨구멍으로 공기가 드나들어요'],
          visual: { type: 'model', model: 'jar', caption: '뚜껑을 덮은 옹기 장독 · 드래그해서 돌려 보세요' },
        },
        {
          title: '크기와 모양에 따라 달라지는 이름',
          text: '옹기는 크기와 모양에 따라 이름이 달라요. 가장 큰 ‘독’, 독보다 조금 작고 배가 부른 ‘중두리’, 아가리가 좁고 배가 부른 ‘항아리’, 작고 목이 짧은 ‘단지’ 등이 있어요. 발효주 저장고 앞 전시대에서 실제 모양을 비교해 보세요.',
          points: ['독 · 중두리 · 항아리 · 단지', '발효주 저장고 앞 옹기 전시에서 직접 살펴보기'],
          visual: { type: 'svg', svg: SVG.jarTypes },
        },
        {
          title: '장독을 돌보는 정성',
          text: '맑은 날에는 뚜껑을 열어 햇볕과 바람을 쐬어 주고, 비가 오기 전에는 뚜껑을 덮어 빗물이 들어가지 않게 했어요. 장독 겉면을 깨끗이 닦아 주는 것도 중요한 일이었지요. 게임 속 내 장독의 ‘환기·햇볕 쬐기·닦기’가 바로 이런 돌봄을 표현한 거예요.',
          points: ['맑은 날: 뚜껑 열고 볕 쬐기', '비 오기 전: 뚜껑 덮기', '겉면을 깨끗하게 닦기'],
          visual: { type: 'model', model: 'jar', opts: { lidOpen: true }, caption: '볕을 쬐려고 뚜껑을 연 장독' },
        },
      ],
      quiz: 'QZ_JANGDOK_1', quizzes: ['QZ_JANGDOK_1', 'QZ_JANGDOK_2', 'QZ_JANGDOK_3'],
      related: ['EDU_FERMENT', 'EDU_DOENJANG'],
    },

    EDU_BEAN: {
      title: '콩과 메주', cat: 'jang', category: '장 담그기', icon: '🫘',
      summary: '모든 장의 출발점인 콩, 그리고 콩을 삶고 찧어 빚는 메주가 어떻게 만들어지는지 알아봐요.',
      pages: [
        {
          title: '장의 시작, 콩',
          text: '된장과 간장, 고추장은 모두 콩에서 시작해요. 우리나라에서는 예로부터 콩을 많이 길러 왔고, 메주를 쑤는 데는 주로 노란 콩(대두)을 썼어요. 콩은 두부, 콩나물, 콩국수 같은 여러 음식의 재료이기도 해요.',
          points: ['장류의 기본 재료는 콩', '메주에는 주로 노란 콩(대두)을 써요'],
          visual: { type: 'model', model: 'bean', caption: '꼬투리가 달린 콩 포기와 콩알' },
        },
        {
          title: '콩밭에서 배우는 콩의 한살이',
          text: '콩은 보통 봄에 씨앗을 뿌리고, 여름 동안 자라 꽃을 피운 뒤 꼬투리가 맺혀요. 가을에 꼬투리가 누렇게 마르면 거두어 털어서 콩알을 얻어요. 콩 뿌리에는 작은 뿌리혹이 생기는데, 이것이 땅을 기름지게 하는 데 도움을 준다고 알려져 있어요.',
          points: ['봄 씨뿌리기 → 여름 꽃 → 가을 거두기', '뿌리혹이 땅을 기름지게 돕는다고 알려져 있어요'],
          visual: { type: 'svg', svg: SVG.beanCycle },
        },
        {
          title: '메주는 어떻게 만들까요?',
          text: '콩을 물에 불려 푹 삶은 다음 절구로 찧어 네모난 덩어리로 빚어요. 겉을 꾸덕하게 말린 뒤 볏짚으로 묶어 따뜻하고 바람이 통하는 곳에 매달아 두면, 볏짚과 공기 중의 미생물이 자리를 잡으며 메주가 ‘떠요’. 메주가 뜬다는 것은 메주가 발효된다는 뜻이에요.',
          points: ['불리기 → 삶기 → 찧기 → 빚기 → 말리기 → 띄우기', '볏짚으로 묶어 바람이 통하는 곳에 매달기'],
          visual: { type: 'model', model: 'meju', caption: '볏짚으로 묶은 메주' },
        },
        {
          title: '메주에서 장으로',
          text: '잘 뜬 메주를 깨끗이 손질해 말린 뒤 소금물과 함께 장독에 담그면 ‘장 담그기’가 시작돼요. 이 한 번의 장 담그기로 된장과 간장을 함께 얻는답니다. 발효식품 구역 작업대에서 수확한 콩으로 메주를 빚어 보세요.',
          points: ['메주 + 소금물 → 장 담그기', '작업대: 콩 3개로 메주 1개 (게임 과정 단순화)'],
          visual: { type: 'steps', items: [{ icon: '🫘', label: '콩' }, { icon: '🧱', label: '메주' }, { icon: '🧂', label: '소금물', sep: '+' }, { icon: '🏺', label: '장 담그기' }], caption: '콩이 장이 되기까지' },
        },
      ],
      quiz: 'QZ_BEAN_1', quizzes: ['QZ_BEAN_1', 'QZ_BEAN_2', 'QZ_BEAN_3'],
      related: ['EDU_DOENJANG', 'EDU_GANJANG', 'EDU_FARMING'],
    },

    EDU_DOENJANG: {
      title: '된장 이야기', cat: 'jang', category: '장 담그기', icon: '🟤',
      summary: '구수한 맛의 된장이 장 담그기와 ‘장 가르기’를 거쳐 어떻게 익어 가는지 알아봐요.',
      pages: [
        {
          title: '된장은 어떤 음식일까요?',
          text: '된장은 메주를 소금물에 담가 두었다가 건져 낸 건더기를 다시 숙성시킨 장이에요. 구수한 맛과 향이 특징이고, 된장찌개·된장국·쌈장처럼 우리 밥상에 자주 오르는 음식에 두루 쓰여요.',
          points: ['재료: 메주 · 소금 · 물', '대표 음식: 된장찌개 · 된장국 · 쌈장'],
          visual: { type: 'model', model: 'doenjang', caption: '옹기 그릇에 담은 된장' },
        },
        {
          title: '장 가르기',
          text: '메주를 소금물에 담그고 얼마간 시간이 지나면 메주 건더기와 검붉은 장물을 나누는데, 이것을 ‘장 가르기’라고 해요. 건더기는 잘 치대어 다시 항아리에 담아 된장으로 익히고, 장물은 간장으로 만들어요.',
          points: ['건더기 → 된장', '장물 → 간장'],
          visual: { type: 'steps', items: [{ icon: '🧱', label: '메주' }, { icon: '🧂', label: '소금물', sep: '+' }, { icon: '✋', label: '장 가르기' }, { icon: '🟤', label: '된장(건더기)' }, { icon: '🫙', label: '간장(장물)', sep: '·' }], caption: '한 번의 장 담그기로 두 가지 장을 얻어요' },
        },
        {
          title: '시간이 만드는 맛',
          text: '된장은 항아리 속에서 오랜 시간 천천히 숙성되며 색이 짙어지고 맛이 깊어져요. 숙성 기간이나 지역, 집집마다의 방법에 따라 맛이 조금씩 달라서 ‘집집마다 장맛이 다르다’는 말도 있지요.',
          points: ['숙성될수록 색은 짙게, 맛은 깊게', '지역과 집마다 다른 장맛'],
          visual: { type: 'model', model: 'jar', caption: '된장이 익어 가는 장독' },
        },
      ],
      quiz: 'QZ_DOENJANG_1', quizzes: ['QZ_DOENJANG_1', 'QZ_DOENJANG_2', 'QZ_DOENJANG_3'],
      related: ['EDU_BEAN', 'EDU_GANJANG'],
    },

    EDU_GANJANG: {
      title: '간장 이야기', cat: 'jang', category: '장 담그기', icon: '🫙',
      summary: '장 가르기에서 얻은 장물이 음식의 간을 맞추는 간장이 되기까지의 이야기예요.',
      pages: [
        {
          title: '간장은 어떻게 만들어질까요?',
          text: '장 가르기 때 메주 건더기를 건져 내고 남은 장물을 따로 모아 숙성시킨 것이 간장이에요. 장물을 한 번 달여서 보관하기도 하는데, 이렇게 하면 더 오래 두고 먹을 수 있어요.',
          points: ['장 가르기 후 남은 장물로 만들어요', '달여서 보관하기도 해요'],
          visual: { type: 'model', model: 'soy', caption: '그릇에 담은 간장' },
        },
        {
          title: '음식의 간을 맞추는 장',
          text: '간장은 짠맛과 감칠맛으로 국, 나물, 조림, 고기 양념 등 여러 음식의 간을 맞추는 데 쓰여요. 담근 지 오래되지 않은 간장은 색이 옅어 국을 끓일 때 많이 쓰고, 오래 묵을수록 색이 짙고 맛이 진해져요.',
          points: ['국 · 나물 · 조림 · 양념', '오래 묵을수록 색이 짙고 맛이 진해져요'],
          visual: { type: 'steps', sep: '', items: [{ icon: '🍲', label: '국' }, { icon: '🥗', label: '나물' }, { icon: '🥘', label: '조림' }, { icon: '🍖', label: '양념' }], caption: '간장이 쓰이는 음식들' },
        },
        {
          title: '간장도 기다림이 필요해요',
          text: '간장 역시 장독 속에서 햇볕과 바람을 받으며 천천히 익어 가요. 맑은 날 뚜껑을 열어 볕을 쬐고, 비 오는 날 덮어 주는 정성이 장맛을 지켜요. 내 장독에서 간장 체험을 시작해 보세요.',
          points: ['장독 돌보기가 장맛을 지켜요'],
          visual: { type: 'model', model: 'jar', opts: { lidOpen: true }, caption: '볕을 쬐는 간장 독' },
        },
      ],
      quiz: 'QZ_GANJANG_1', quizzes: ['QZ_GANJANG_1', 'QZ_GANJANG_2'],
      related: ['EDU_DOENJANG', 'EDU_JANGDOK'],
    },

    EDU_GOCHUJANG: {
      title: '고추장 이야기', cat: 'jang', category: '장 담그기', icon: '🌶️',
      summary: '매운맛과 단맛, 감칠맛이 어우러진 고추장의 재료와 만드는 원리를 알아봐요.',
      pages: [
        {
          title: '매콤달콤한 우리 장',
          text: '고추장은 고춧가루에 익힌 찹쌀(또는 보리·밀 같은 곡물)을 섞고, 메줏가루와 엿기름, 소금 등을 더해 숙성시킨 장이에요. 매운맛과 단맛, 감칠맛이 어우러진 것이 특징이고 비빔밥, 떡볶이, 고추장찌개 등에 쓰여요.',
          points: ['매운맛 + 단맛 + 감칠맛', '대표 음식: 비빔밥 · 떡볶이 · 고추장찌개'],
          visual: { type: 'model', model: 'gochujang', caption: '단지에 담은 고추장' },
        },
        {
          title: '고추장의 재료',
          text: '곡물의 녹말은 엿기름 속 효소의 작용으로 단맛을 내고, 메줏가루는 구수한 맛을 더해요. 여기에 고춧가루의 매운맛과 소금의 짠맛이 어우러지지요. 재료와 비율은 집과 지역마다 조금씩 달라요.',
          points: ['고춧가루 · 찹쌀 · 메줏가루 · 엿기름 · 소금', '엿기름이 단맛을 내는 데 도움을 줘요'],
          visual: { type: 'steps', items: [{ icon: '🌶️', label: '고춧가루' }, { icon: '🍚', label: '찹쌀', sep: '+' }, { icon: '🧱', label: '메줏가루', sep: '+' }, { icon: '🌾', label: '엿기름', sep: '+' }, { icon: '🧂', label: '소금', sep: '+' }, { icon: '🔴', label: '고추장' }], caption: '고추장의 재료 (집집마다 조금씩 달라요)' },
        },
        {
          title: '고추에서 고춧가루로',
          text: '빨갛게 익은 고추를 따서 햇볕에 잘 말린 뒤 빻으면 고춧가루가 돼요. 전통작물 구역에서 기른 고추를 수확해 발효식품 구역 작업대에서 빻아 고춧가루를 만들어 보세요.',
          points: ['익은 고추 → 말리기 → 빻기', '작업대: 고추 3개로 고춧가루 1개 (게임 과정 단순화)'],
          visual: { type: 'model', model: 'pepper', caption: '소쿠리에 담은 고추' },
        },
      ],
      quiz: 'QZ_GOCHUJANG_1', quizzes: ['QZ_GOCHUJANG_1', 'QZ_GOCHUJANG_2'],
      related: ['EDU_BEAN', 'EDU_KIMCHI'],
    },

    EDU_KIMCHI: {
      title: '김치와 발효', cat: 'kimchi', category: '김치', icon: '🥬',
      summary: '채소를 절이고 양념해 익히는 김치, 새콤한 맛을 만드는 젖산 발효와 김장 문화를 만나요.',
      pages: [
        {
          title: '김치는 어떤 음식일까요?',
          text: '김치는 배추나 무 같은 채소를 소금에 절인 뒤 고춧가루·마늘·생강·젓갈 등으로 만든 양념에 버무려 발효시킨 음식이에요. 배추김치, 깍두기, 동치미, 열무김치처럼 재료와 지역에 따라 종류가 아주 많아요.',
          points: ['절이기 → 양념 버무리기 → 익히기', '배추김치 · 깍두기 · 동치미 · 열무김치'],
          visual: { type: 'model', model: 'cabbage', caption: '김치의 주재료, 배추' },
        },
        {
          title: '새콤한 맛의 비밀, 젖산 발효',
          text: '김치가 익어 가는 동안 젖산균이 채소 속 당분을 먹고 젖산을 만들어요. 그래서 시간이 지날수록 새콤한 맛이 나는데, 이 산미가 김치 맛을 이루는 중요한 요소예요.',
          points: ['젖산균이 당분을 젖산으로 바꿔요', '익을수록 새콤해져요'],
          visual: { type: 'model', model: 'kimchi', caption: '김칫독에서 익어 가는 김치' },
        },
        {
          title: '온도가 맛을 바꿔요',
          text: '김치는 온도가 높으면 빨리 익어 금방 시어지고, 서늘하고 낮은 온도에서는 천천히 익어요. 예전에는 겨울 동안 김칫독을 땅에 묻어 온도를 고르게 유지하며 오래 두고 먹었어요.',
          points: ['따뜻하면 빨리, 서늘하면 천천히 익어요', '김칫독을 땅에 묻어 보관했어요'],
          visual: { type: 'svg', svg: SVG.kimchiBuried },
        },
        {
          title: '함께 담그고 나누는 김장',
          text: '겨울을 앞두고 가족과 이웃이 함께 많은 양의 김치를 담그는 것을 ‘김장’이라고 해요. 서로 돕고 나누는 김장 문화는 유네스코 인류무형문화유산으로 등재되어 있어요.',
          points: ['이웃과 함께 담그고 나누는 문화', '유네스코 인류무형문화유산'],
          visual: { type: 'steps', sep: '', items: [{ icon: '👵', label: '할머니' }, { icon: '🧑‍🍳', label: '가족' }, { icon: '🧑‍🤝‍🧑', label: '이웃' }, { icon: '🥬', label: '나눔' }], caption: '김장은 함께하는 일' },
        },
      ],
      quiz: 'QZ_KIMCHI_1', quizzes: ['QZ_KIMCHI_1', 'QZ_KIMCHI_2', 'QZ_KIMCHI_3'],
      related: ['EDU_FERMENT', 'EDU_GOCHUJANG'],
    },

    EDU_FARMING: {
      title: '전통농업과 절기', cat: 'farming', category: '전통농업', icon: '🌾',
      summary: '해의 움직임으로 계절을 나눈 24절기와, 마을이 함께 농사짓던 두레 이야기를 알아봐요.',
      pages: [
        {
          title: '24절기란?',
          text: '24절기는 해의 움직임을 기준으로 한 해를 스물네 마디로 나눈 것으로, 계절의 변화를 알려 주는 달력 역할을 했어요. 농부들은 절기에 맞춰 씨를 뿌리고, 김을 매고, 곡식을 거두었어요.',
          points: ['해의 움직임을 기준으로 나눈 24마디', '농사 일정을 알려 주는 달력'],
          visual: { type: 'model', model: 'season', caption: '사계절과 24절기 · 해가 한 바퀴 돌아요' },
        },
        {
          title: '봄과 여름의 절기',
          text: '입춘은 봄이 시작된다는 뜻이고, 곡우에는 봄비가 내려 곡식을 기름지게 한다고 했어요. 망종은 곡식의 씨를 뿌리기 좋은 때, 하지는 1년 중 낮이 가장 긴 날이에요. 절기 이름에 농사 이야기가 담겨 있지요.',
          points: ['입춘 · 곡우 · 망종 · 하지'],
          visual: { type: 'steps', items: [{ icon: '🌱', label: '입춘' }, { icon: '🌧️', label: '곡우' }, { icon: '🌾', label: '망종' }, { icon: '☀️', label: '하지' }], caption: '봄에서 여름으로' },
        },
        {
          title: '가을과 겨울의 절기',
          text: '입추는 가을의 시작, 추분은 낮과 밤의 길이가 비슷해지는 때예요. 상강에는 서리가 내리기 시작하고, 입동은 겨울의 시작, 동지는 1년 중 밤이 가장 긴 날이에요. 입동 무렵에는 김장을 하는 집이 많았어요.',
          points: ['입추 · 추분 · 상강 · 입동 · 동지', '입동 무렵 김장 준비'],
          visual: { type: 'steps', items: [{ icon: '🍂', label: '입추' }, { icon: '⚖️', label: '추분' }, { icon: '❄️', label: '상강' }, { icon: '⛄', label: '동지' }], caption: '가을에서 겨울로' },
        },
        {
          title: '함께 짓는 농사, 두레',
          text: '모내기나 김매기처럼 일손이 많이 필요할 때는 마을 사람들이 함께 일했어요. 이렇게 서로 돕는 공동 노동 조직을 ‘두레’라고 하고, 일하며 부르는 노동요와 풍물이 흥을 돋웠어요. 전통작물 구역에서 다른 체험객과 함께 밭을 가꿔 보세요.',
          points: ['서로 돕는 공동 노동 조직, 두레', '노동요와 풍물로 흥을 돋워요'],
          visual: { type: 'emoji', emoji: '👨‍🌾🤝👩‍🌾', caption: '함께 일하면 힘든 일도 즐겁게' },
        },
      ],
      quiz: 'QZ_FARMING_1', quizzes: ['QZ_FARMING_1', 'QZ_FARMING_2', 'QZ_FARMING_3'],
      related: ['EDU_BEAN', 'EDU_TOOLS'],
    },

    EDU_TOOLS: {
      title: '전통 농기구', cat: 'tools', category: '전통도구', icon: '🛠️',
      summary: '지게·맷돌·절구·키·호미·시루처럼 옛사람들의 지혜가 담긴 생활 도구를 살펴봐요.',
      pages: [
        {
          title: '등에 지는 운반 도구, 지게',
          text: '지게는 나무로 만든 운반 도구로, 양쪽 어깨에 멜빵을 걸어 등에 지고 짐을 날랐어요. 무거운 짐도 몸 전체로 나누어 질 수 있어서 산과 비탈이 많은 우리 땅에서 특히 많이 쓰였어요.',
          points: ['나무 몸체 + 짚 멜빵', '산길과 비탈길에서도 짐을 나르기 좋아요'],
          visual: { type: 'model', model: 'jige', caption: '지게와 지겟작대기' },
        },
        {
          title: '가는 맷돌, 찧는 절구',
          text: '맷돌은 둥근 돌 두 개를 포개어 위짝을 손잡이로 돌리며 콩이나 곡식을 가는 도구예요. 절구는 우묵한 통에 곡식을 넣고 절굿공이로 찧거나 빻을 때 썼어요. 메주를 만들 때 삶은 콩을 찧는 데도 절구를 사용했지요.',
          points: ['맷돌: 돌려서 갈기', '절구: 내리쳐서 찧기·빻기'],
          visual: { type: 'model', model: 'maetdol', caption: '맷돌 · 드래그해서 돌려 보세요' },
        },
        {
          title: '키 · 호미 · 시루',
          text: '키는 곡식을 까불러 껍질과 티끌을 골라내는 도구, 호미는 김을 매고 흙을 고르는 작은 농기구예요. 시루는 바닥에 구멍이 뚫린 질그릇으로, 솥 위에 올려 떡이나 곡식을 쪄 냈어요. 전통도구 전시장에서 직접 살펴보세요.',
          points: ['키: 까불러 고르기', '호미: 김매기·흙 고르기', '시루: 떡·곡식 찌기'],
          visual: { type: 'steps', sep: '', items: [{ icon: '🧺', label: '키' }, { icon: '⛏️', label: '호미' }, { icon: '🍲', label: '시루' }, { icon: '🥣', label: '절구' }], caption: '전통도구 전시장에서 만나요' },
        },
      ],
      quiz: 'QZ_TOOLS_1', quizzes: ['QZ_TOOLS_1', 'QZ_TOOLS_2', 'QZ_TOOLS_3'],
      related: ['EDU_FARMING', 'EDU_BEAN'],
    },
  };
  for (const [id, e] of Object.entries(G.data.education)) {
    e.id = id;
    e.source = e.source || SRC;
    e.author = e.author || AUTHOR;
    e.referenceDate = e.referenceDate || REF_DATE;
    e.verified = false;
    e.color = e.color || (G.data.educationCategories[e.cat] || {}).color || '#34c36b';
    e.pages.forEach((p, i) => { p.index = i; });
  }

  // ---------------------------------------------------------------- quizzes (reward: first correct answer only)
  const R = () => ({ exp: 100, edu: 10 });
  G.data.quizzes = {
    QZ_FERMENT_1: { edu: 'EDU_FERMENT', question: '발효를 일으키는 주인공은 무엇일까요?', choices: ['미생물', '햇빛', '소금', '바람'], answer: 0, explain: '발효는 효모·곰팡이·세균 같은 미생물이 음식 성분을 분해하고 바꾸는 과정이에요. 햇빛·소금·바람은 발효 환경에 영향을 줄 뿐이에요.' },
    QZ_FERMENT_2: { edu: 'EDU_FERMENT', question: '발효와 부패를 구분하는 기준으로 가장 알맞은 것은?', choices: ['미생물이 있는지 없는지', '사람에게 이롭고 먹기 좋은 변화인지', '색깔이 변했는지', '냄새가 나는지'], answer: 1, explain: '발효와 부패는 모두 미생물이 일으키는 변화예요. 사람에게 이롭고 먹기 좋게 변하면 발효, 먹을 수 없게 상하면 부패라고 해요.' },
    QZ_FERMENT_3: { edu: 'EDU_FERMENT', question: '다음 중 발효 음식이 아닌 것은?', choices: ['김치', '된장', '식초', '생수'], answer: 3, explain: '김치·된장·식초는 모두 미생물의 작용으로 만들어지는 발효 음식이에요. 생수는 발효 과정을 거치지 않아요.' },

    QZ_JANGDOK_1: { edu: 'EDU_JANGDOK', question: '옹기를 ‘숨 쉬는 그릇’이라고 부르는 까닭은?', choices: ['그릇 벽에 미세한 숨구멍이 있어서', '살아 있는 생물로 만들어서', '뚜껑에 큰 구멍이 뚫려 있어서', '물에 넣으면 거품이 나서'], answer: 0, explain: '옹기는 흙으로 빚어 구운 그릇으로, 그릇 벽의 미세한 숨구멍으로 공기가 조금씩 드나들어 ‘숨 쉬는 그릇’이라고 불려요.' },
    QZ_JANGDOK_2: { edu: 'EDU_JANGDOK', question: '장독대를 두기에 가장 알맞은 곳은?', choices: ['습하고 그늘진 지하실', '햇볕이 잘 들고 바람이 잘 통하는 곳', '물이 고이는 낮은 땅', '아궁이 바로 옆'], answer: 1, explain: '장독대는 햇볕이 잘 들고 바람이 잘 통하는 곳에, 빗물이 고이지 않도록 돌을 쌓아 높게 만들었어요.' },
    QZ_JANGDOK_3: { edu: 'EDU_JANGDOK', question: '옹기 가운데 아가리가 좁고 배가 부른 그릇의 이름은?', choices: ['시루', '단지', '항아리', '소쿠리'], answer: 2, explain: '아가리가 좁고 배가 부른 옹기를 항아리라고 해요. 단지는 작고 목이 짧은 그릇, 시루는 떡을 찌는 그릇이에요.' },

    QZ_BEAN_1: { edu: 'EDU_BEAN', question: '메주를 만드는 순서로 알맞은 것은?', choices: ['콩 볶기 → 갈기 → 끓이기 → 얼리기', '콩 씻기 → 튀기기 → 자르기 → 굽기', '콩 삶기 → 찧기 → 빚기 → 말려 띄우기', '콩 불리기 → 싹 틔우기 → 말리기 → 빻기'], answer: 2, explain: '메주는 불린 콩을 푹 삶아 찧은 뒤 네모나게 빚고, 말려서 볏짚에 묶어 띄워 만들어요.' },
    QZ_BEAN_2: { edu: 'EDU_BEAN', question: '메주를 볏짚으로 묶어 매달아 두는 까닭으로 가장 알맞은 것은?', choices: ['모양을 예쁘게 하려고', '바람이 잘 통하고 볏짚의 미생물이 발효를 돕도록', '벌레를 쫓으려고', '무게를 재려고'], answer: 1, explain: '볏짚에는 발효를 돕는 미생물이 많이 산다고 알려져 있어요. 매달아 두면 바람도 잘 통해 메주가 고르게 마르고 잘 떠요.' },
    QZ_BEAN_3: { edu: 'EDU_BEAN', question: '콩 뿌리에 생기는 뿌리혹이 하는 일로 알려진 것은?', choices: ['꽃을 피운다', '땅을 기름지게 돕는다', '열매를 단단하게 만든다', '벌레를 잡아먹는다'], answer: 1, explain: '콩 뿌리의 뿌리혹은 땅을 기름지게 하는 데 도움을 준다고 알려져 있어요. 그래서 콩을 기르면 밭이 좋아진다는 말이 전해져요.' },

    QZ_DOENJANG_1: { edu: 'EDU_DOENJANG', question: '된장과 관련이 깊은 재료는?', choices: ['콩', '사과', '딸기', '바나나'], answer: 0, explain: '된장은 콩을 삶아 빚은 메주로 만들어요. 콩은 된장·간장·고추장 같은 장류의 기본 재료랍니다.' },
    QZ_DOENJANG_2: { edu: 'EDU_DOENJANG', question: '장을 담근 뒤 메주 건더기와 장물을 나누는 일을 무엇이라고 할까요?', choices: ['김장', '모내기', '장 가르기', '타작'], answer: 2, explain: '메주 건더기와 장물을 나누는 일을 ‘장 가르기’라고 해요. 건더기는 된장, 장물은 간장이 돼요.' },
    QZ_DOENJANG_3: { edu: 'EDU_DOENJANG', question: '장 가르기 후 메주 건더기로 만드는 장은?', choices: ['간장', '된장', '식초', '젓갈'], answer: 1, explain: '장 가르기 후 건더기를 치대어 다시 숙성시킨 것이 된장이에요. 남은 장물로는 간장을 만들어요.' },

    QZ_GANJANG_1: { edu: 'EDU_GANJANG', question: '간장은 장 담그기의 어느 부분으로 만들까요?', choices: ['메주 건더기', '콩깍지', '볏짚', '메주를 건져 내고 남은 장물'], answer: 3, explain: '장 가르기 때 메주 건더기를 건져 내고 남은 장물을 숙성시킨 것이 간장이에요.' },
    QZ_GANJANG_2: { edu: 'EDU_GANJANG', question: '간장의 쓰임으로 가장 알맞은 것은?', choices: ['음식의 간을 맞춘다', '옷감을 물들인다', '장독을 닦는다', '씨앗을 소독한다'], answer: 0, explain: '간장은 짠맛과 감칠맛으로 국, 나물, 조림, 양념 등 여러 음식의 간을 맞추는 데 쓰여요.' },

    QZ_GOCHUJANG_1: { edu: 'EDU_GOCHUJANG', question: '고추장을 만드는 재료가 아닌 것은?', choices: ['고춧가루', '찹쌀', '메줏가루', '우유'], answer: 3, explain: '고추장은 고춧가루, 찹쌀 같은 곡물, 메줏가루, 엿기름, 소금 등으로 만들어요. 우유는 들어가지 않아요.' },
    QZ_GOCHUJANG_2: { edu: 'EDU_GOCHUJANG', question: '고춧가루는 어떻게 만들까요?', choices: ['고추를 물에 끓인다', '익은 고추를 말려서 빻는다', '고추를 얼린다', '고춧잎을 갈아 만든다'], answer: 1, explain: '빨갛게 익은 고추를 햇볕에 잘 말린 뒤 빻으면 고춧가루가 돼요.' },

    QZ_KIMCHI_1: { edu: 'EDU_KIMCHI', question: '김치가 익으며 새콤해지는 것은 어떤 미생물 덕분일까요?', choices: ['곰팡이', '바이러스', '젖산균', '짚신벌레'], answer: 2, explain: '김치가 익는 동안 젖산균이 채소 속 당분을 젖산으로 바꾸어 새콤한 맛이 나요.' },
    QZ_KIMCHI_2: { edu: 'EDU_KIMCHI', question: '겨울을 앞두고 가족과 이웃이 함께 김치를 많이 담그는 일은?', choices: ['단오', '김장', '장 가르기', '추수'], answer: 1, explain: '겨울을 앞두고 함께 김치를 담그고 나누는 일을 김장이라고 해요. 김장 문화는 유네스코 인류무형문화유산으로 등재되어 있어요.' },
    QZ_KIMCHI_3: { edu: 'EDU_KIMCHI', question: '김치를 천천히 익히고 싶을 때 알맞은 보관 방법은?', choices: ['서늘하고 낮은 온도에 둔다', '햇볕이 드는 따뜻한 곳에 둔다', '뚜껑을 활짝 열어 둔다', '물을 가득 붓는다'], answer: 0, explain: '김치는 따뜻하면 빨리 익고 서늘하면 천천히 익어요. 그래서 예전에는 김칫독을 땅에 묻어 온도를 고르게 지켰어요.' },

    QZ_FARMING_1: { edu: 'EDU_FARMING', question: '24절기는 무엇을 기준으로 한 해를 나눈 것일까요?', choices: ['해의 움직임', '바닷물의 높이', '바람의 세기', '별의 개수'], answer: 0, explain: '24절기는 해의 움직임을 기준으로 한 해를 스물네 마디로 나눈 것으로, 농사 시기를 알려 주는 달력 역할을 했어요.' },
    QZ_FARMING_2: { edu: 'EDU_FARMING', question: '1년 중 낮의 길이가 가장 긴 절기는?', choices: ['동지', '하지', '춘분', '입추'], answer: 1, explain: '하지는 1년 중 낮이 가장 긴 날이고, 동지는 밤이 가장 긴 날이에요.' },
    QZ_FARMING_3: { edu: 'EDU_FARMING', question: '마을 사람들이 함께 농사일을 하던 공동 노동 조직은?', choices: ['장터', '서당', '향교', '두레'], answer: 3, explain: '모내기·김매기처럼 일손이 많이 필요할 때 마을 사람들이 함께 일하던 조직을 두레라고 해요.' },

    QZ_TOOLS_1: { edu: 'EDU_TOOLS', question: '나무로 만들어 등에 지고 짐을 나르던 도구는?', choices: ['지게', '맷돌', '시루', '키'], answer: 0, explain: '지게는 나무 몸체에 짚 멜빵을 달아 등에 지고 짐을 나르던 운반 도구예요.' },
    QZ_TOOLS_2: { edu: 'EDU_TOOLS', question: '둥근 돌 두 개를 포개어 돌리며 콩이나 곡식을 가는 도구는?', choices: ['호미', '맷돌', '절구', '지게'], answer: 1, explain: '맷돌은 위짝을 손잡이로 돌려 콩이나 곡식을 가는 돌 도구예요. 절구는 내리쳐서 찧는 도구예요.' },
    QZ_TOOLS_3: { edu: 'EDU_TOOLS', question: '곡식을 까불러 껍질과 티끌을 골라내는 도구는?', choices: ['시루', '호미', '키', '절구'], answer: 2, explain: '키는 곡식을 담아 위아래로 까불러 가벼운 껍질과 티끌을 날려 보내는 도구예요.' },
  };
  for (const [id, q] of Object.entries(G.data.quizzes)) {
    q.id = id;
    q.reward = q.reward || R();
  }

  // ---------------------------------------------------------------- exhibit food cards (fermentation zone tables)
  G.data.exhibitInfo = {
    EXH_DOENJANG: {
      model: 'doenjang', tagline: '구수한 맛의 기본 장',
      text: '메주를 소금물에 담갔다가 건져 낸 건더기를 숙성시킨 장이에요. 오래 익을수록 색이 짙어지고 맛이 깊어져요.',
      facts: [['주재료', '메주 · 소금 · 물'], ['맛', '구수하고 짭짤해요'], ['대표 음식', '된장찌개 · 된장국 · 쌈장']],
    },
    EXH_GANJANG: {
      model: 'soy', tagline: '음식의 간을 맞추는 장',
      text: '장 가르기 때 메주를 건져 내고 남은 장물을 숙성시킨 장이에요. 국, 나물, 조림 등 여러 음식에 두루 쓰여요.',
      facts: [['주재료', '메주를 담근 장물'], ['맛', '짭짤하고 감칠맛이 나요'], ['쓰임', '국 · 나물 · 조림 · 양념']],
    },
    EXH_GOCHUJANG: {
      model: 'gochujang', tagline: '매콤달콤한 우리 장',
      text: '고춧가루와 익힌 곡물, 메줏가루, 엿기름, 소금 등을 섞어 숙성시킨 장이에요. 매운맛과 단맛, 감칠맛이 어우러져요.',
      facts: [['주재료', '고춧가루 · 찹쌀 · 메줏가루 · 엿기름 · 소금'], ['맛', '맵고 달콤하며 감칠맛'], ['대표 음식', '비빔밥 · 떡볶이 · 고추장찌개']],
    },
    EXH_KIMCHI: {
      model: 'kimchi', tagline: '젖산 발효로 익는 채소 음식',
      text: '절인 채소를 양념에 버무려 발효시킨 음식이에요. 젖산균이 만드는 새콤한 맛이 특징이고 종류가 아주 다양해요.',
      facts: [['주재료', '배추 · 무 · 고춧가루 · 마늘 · 젓갈'], ['발효', '젖산균에 의한 젖산 발효'], ['종류', '배추김치 · 깍두기 · 동치미 · 열무김치']],
    },
    EXH_VINEGAR: {
      model: 'vinegar', tagline: '술이 한 번 더 발효된 맛',
      text: '곡물이나 과일로 빚은 술을 초산균이 한 번 더 발효시켜 만든 식초예요. 새콤한 맛으로 무침과 냉국 등에 쓰여요.',
      facts: [['주재료', '곡물이나 과일로 빚은 술'], ['발효', '초산균이 술을 식초로 바꿔요'], ['쓰임', '무침 · 냉국 · 절임']],
    },
  };

  // ---------------------------------------------------------------- hall guide (HALL_DOOR)
  G.data.hallGuide = {
    title: '전통발효체험관 안내',
    intro: '현대식 유리 전시관과 한옥 지붕이 어우러진 체험관 본관이에요. 층마다 마련된 전시를 교육 콘텐츠로 살펴볼 수 있어요.',
    floors: [
      { floor: '3F', name: '전망 라운지', icon: '🏔️', color: '#6fb6e8', desc: '산과 계곡, 장독대와 전통작물 밭을 한눈에 내려다보는 라운지예요. 절기에 따라 달라지는 들판과 옛 농기구 이야기를 만나 보세요.', edu: ['EDU_FARMING', 'EDU_TOOLS'] },
      { floor: '2F', name: '체험 교실', icon: '🧑‍🏫', color: '#7fbf5a', desc: '메주 빚기와 장 담그기, 김치 담그기 과정을 단계별로 배우는 교실이에요. 배운 뒤에는 퀴즈로 실력을 확인해 보세요.', edu: ['EDU_BEAN', 'EDU_GANJANG', 'EDU_GOCHUJANG', 'EDU_KIMCHI'] },
      { floor: '1F', name: '발효 전시실', icon: '🏺', color: '#e0a35a', desc: '장류·김치·식초 같은 발효 음식과 다양한 옹기를 전시하는 공간이에요. 발효의 기본 원리와 장독대 문화를 소개해요.', edu: ['EDU_FERMENT', 'EDU_JANGDOK', 'EDU_DOENJANG'] },
    ],
    note: '실제 체험관 운영 정보(관람 시간·요금 등)는 게임과 무관하며 별도로 확인해야 해요.',
  };

  // ---------------------------------------------------------------- 쉬운 모드 (CONTRACT §12): kid versions
  // content.kid = { title, summary (2–3 short sentences + emoji), slides:[3 × { text, vis:pageIndex | steps:[[icon,label]] | emoji }] }
  //   vis reuses that page's picture (3D model / illustration); steps draws a picture row; emoji shows one big picture.
  // quiz.kid    = { q, choices:[{e, t}] (2–3 pictures), answer, hint, why }  or  { q, ox:true, answer:true|false, hint, why }
  //   The kid quiz is the same quiz id: rewards stay "first correct answer only" (server SaveValidator unchanged).
  const KID_EDU = {
    EDU_FERMENT: {
      title: '발효가 뭐예요?', summary: '눈에 안 보이는 작은 친구, 미생물이 음식을 맛있게 바꿔요! 🦠✨',
      slides: [
        { vis: 0, text: '아주아주 작은 친구들이 있어요. 미생물이라고 불러요 🦠' },
        { steps: [['🫘', '콩'], ['🦠', '미생물'], ['🟤', '된장']], text: '미생물이 콩을 바꾸면 구수한 된장이 돼요!' },
        { vis: 3, text: '천천히 기다릴수록 맛이 더 깊어져요 ⏳' },
      ],
    },
    EDU_JANGDOK: {
      title: '장독대와 옹기', summary: '장독대는 맛있는 장이 사는 집이에요. 옹기는 숨을 쉬는 그릇이에요 🏺',
      slides: [
        { vis: 0, text: '햇볕 잘 들고 바람 솔솔 부는 곳에 장독을 모아 둬요 ☀️' },
        { vis: 1, text: '옹기는 흙으로 만든 그릇이에요. 작은 숨구멍으로 숨을 쉬어요 🌬️' },
        { vis: 3, text: '맑은 날엔 뚜껑을 열고, 비가 오면 꼭 덮어 줘요 ☔' },
      ],
    },
    EDU_BEAN: {
      title: '콩과 메주', summary: '모든 장은 콩에서 시작해요. 콩을 삶고 찧어서 메주를 만들어요 🫘',
      slides: [
        { vis: 0, text: '된장, 간장, 고추장은 모두 콩으로 만들어요 🫘' },
        { vis: 1, text: '봄에 심은 콩이 쑥쑥 자라서 가을에 콩알이 열려요 🌱' },
        { vis: 2, text: '콩을 삶고 콩콩 찧어서 네모난 메주를 만들어요 🧱' },
      ],
    },
    EDU_DOENJANG: {
      title: '된장 이야기', summary: '된장은 메주로 만든 구수한 장이에요. 된장찌개 맛있죠? 🍲',
      slides: [
        { vis: 0, text: '된장은 구수한 맛이 나는 장이에요 🟤' },
        { steps: [['🧱', '메주'], ['🧂', '소금물'], ['🟤', '된장'], ['🫙', '간장']], text: '메주를 소금물에 담갔다가 나누면 된장과 간장이 돼요!' },
        { emoji: '🍲😋', text: '된장찌개랑 된장국을 끓일 때 써요. 냠냠!' },
      ],
    },
    EDU_GANJANG: {
      title: '간장 이야기', summary: '간장은 음식을 알맞게 짭짤하게 해 줘요 🫙',
      slides: [
        { vis: 0, text: '메주를 건져 내고 남은 까만 물로 간장을 만들어요 🫙' },
        { vis: 1, text: '국이랑 나물에 조금 넣으면 맛있어져요 🍲' },
        { vis: 2, text: '간장도 장독에서 햇볕을 쬐며 천천히 익어요 ☀️' },
      ],
    },
    EDU_GOCHUJANG: {
      title: '고추장 이야기', summary: '고추장은 맵고 달콤한 빨간 장이에요 🌶️',
      slides: [
        { vis: 0, text: '고추장은 맵고 달콤한 빨간 장이에요 🔴' },
        { steps: [['🌶️', '고춧가루'], ['🍚', '찹쌀'], ['🧱', '메주'], ['🔴', '고추장']], text: '고춧가루랑 찹쌀이랑 메주를 섞어서 만들어요!' },
        { vis: 2, text: '빨간 고추를 햇볕에 말리고 빻으면 고춧가루가 돼요 ☀️' },
      ],
    },
    EDU_KIMCHI: {
      title: '김치 이야기', summary: '배추를 절이고 양념에 버무려 익히면 새콤한 김치가 돼요 🥬',
      slides: [
        { vis: 0, text: '배추를 소금에 절이고 빨간 양념을 발라요 🥬' },
        { vis: 1, text: '작은 젖산균 친구가 김치를 새콤하게 만들어요 😋' },
        { vis: 3, text: '겨울이 오기 전에 다 같이 김장을 하고 나눠 먹어요 🤝' },
      ],
    },
    EDU_FARMING: {
      title: '절기와 농사', summary: '해님을 보고 계절을 나누어 씨를 뿌리고 거두었어요 🌞',
      slides: [
        { vis: 0, text: '해님의 움직임을 보고 일 년을 스물네 마디로 나눴어요 🌞' },
        { steps: [['🌱', '봄'], ['☀️', '여름'], ['🍂', '가을'], ['⛄', '겨울']], text: '봄에는 씨를 뿌리고, 가을에는 곡식을 거둬요 🌾' },
        { vis: 3, text: '마을 사람들이 다 같이 도우며 농사를 지었어요. 두레라고 해요 🤝' },
      ],
    },
    EDU_TOOLS: {
      title: '옛날 도구', summary: '옛날 사람들은 지게, 맷돌, 호미 같은 도구로 일했어요 🛠️',
      slides: [
        { vis: 0, text: '지게는 등에 메고 무거운 짐을 나르는 도구예요 🪵' },
        { vis: 1, text: '맷돌은 빙글빙글 돌려서 콩을 가는 돌이에요 🪨' },
        { vis: 2, text: '키, 호미, 시루, 절구도 있어요. 전시장에서 찾아봐요! 🔍' },
      ],
    },
  };
  const KID_QUIZ = {
    QZ_FERMENT_1: { q: '발효를 일으키는 작은 친구는 누구일까요?', choices: [{ e: '🦠', t: '미생물' }, { e: '☀️', t: '햇빛' }, { e: '💨', t: '바람' }], answer: 0, hint: '눈에 안 보이는 아주 작은 친구예요 🔍', why: '미생물이 음식을 맛있게 바꿔 줘요!' },
    QZ_FERMENT_2: { q: '발효는 음식을 먹기 좋게 바꾸는 거예요. 맞을까요?', ox: true, answer: true, hint: '된장이랑 김치를 떠올려 봐요 🟤', why: '맞아요! 상해서 못 먹게 되면 부패라고 해요.' },
    QZ_FERMENT_3: { q: '발효 음식이 아닌 것은 무엇일까요?', choices: [{ e: '🥬', t: '김치' }, { e: '🟤', t: '된장' }, { e: '💧', t: '물' }], answer: 2, hint: '그대로 꿀꺽 마시는 거예요 💧', why: '물은 발효하지 않아요. 김치랑 된장은 발효 음식이에요!' },
    QZ_JANGDOK_1: { q: '옹기를 왜 숨 쉬는 그릇이라고 할까요?', choices: [{ e: '🌬️', t: '작은 숨구멍이 있어서' }, { e: '🐟', t: '물고기가 살아서' }], answer: 0, hint: '그릇 벽에 아주 작은 구멍이 있어요 🔍', why: '맞아요! 작은 숨구멍으로 공기가 솔솔 드나들어요.' },
    QZ_JANGDOK_2: { q: '장독대는 어디에 두면 좋을까요?', choices: [{ e: '☀️', t: '햇볕 잘 드는 곳' }, { e: '🌑', t: '깜깜한 곳' }, { e: '💦', t: '물웅덩이' }], answer: 0, hint: '장독은 햇볕을 좋아해요 ☀️', why: '햇볕 잘 들고 바람 잘 통하는 곳이 좋아요!' },
    QZ_JANGDOK_3: { q: '배가 볼록하고 입구가 좁은 옹기는 무엇일까요?', choices: [{ e: '🏺', t: '항아리' }, { e: '🧺', t: '소쿠리' }, { e: '🍲', t: '시루' }], answer: 0, hint: '고추장을 담아 두는 볼록한 그릇이에요 🏺', why: '맞아요! 볼록한 배의 항아리예요.' },
    QZ_BEAN_1: { q: '메주는 무엇으로 만들까요?', choices: [{ e: '🫘', t: '콩' }, { e: '🍎', t: '사과' }, { e: '🥕', t: '당근' }], answer: 0, hint: '장은 모두 이걸로 시작해요 🫘', why: '콩을 삶고 찧어서 메주를 만들어요!' },
    QZ_BEAN_2: { q: '메주를 볏짚으로 묶어 바람이 솔솔 부는 곳에 매달아요. 맞을까요?', ox: true, answer: true, hint: '메주도 바람을 좋아해요 🌬️', why: '맞아요! 볏짚 속 작은 친구들이 메주를 잘 띄워 줘요.' },
    QZ_BEAN_3: { q: '콩 뿌리에 붙은 작은 혹은 무엇을 도울까요?', choices: [{ e: '🌱', t: '땅을 튼튼하게' }, { e: '🐛', t: '벌레 잡기' }], answer: 0, hint: '콩을 심으면 밭이 좋아진대요 🌱', why: '맞아요! 땅을 기름지게 도와준대요.' },
    QZ_DOENJANG_1: { q: '된장은 무엇으로 만들까요?', choices: [{ e: '🫘', t: '콩' }, { e: '🍓', t: '딸기' }, { e: '🍌', t: '바나나' }], answer: 0, hint: '메주를 만드는 재료예요 🧱', why: '콩으로 만든 메주로 된장을 만들어요!' },
    QZ_DOENJANG_2: { q: '메주 건더기와 장물을 나누는 일은 무엇일까요?', choices: [{ e: '✋', t: '장 가르기' }, { e: '🥬', t: '김장' }, { e: '🌾', t: '모내기' }], answer: 0, hint: '나눈다는 말은 "가르다"예요 ✋', why: '맞아요! 장 가르기라고 해요.' },
    QZ_DOENJANG_3: { q: '메주 건더기로 만드는 장은 무엇일까요?', choices: [{ e: '🟤', t: '된장' }, { e: '🫙', t: '간장' }], answer: 0, hint: '건더기는 꾸덕꾸덕해요 🟤', why: '건더기는 된장, 까만 물은 간장이 돼요!' },
    QZ_GANJANG_1: { q: '간장은 무엇으로 만들까요?', choices: [{ e: '🫙', t: '메주를 건지고 남은 물' }, { e: '🌾', t: '볏짚' }], answer: 0, hint: '메주를 건져 내고 남은 까만 물이에요 🫙', why: '맞아요! 남은 장물을 익히면 간장이 돼요.' },
    QZ_GANJANG_2: { q: '간장은 어디에 쓸까요?', choices: [{ e: '🍲', t: '음식 맛 내기' }, { e: '👕', t: '옷 물들이기' }, { e: '🧽', t: '장독 닦기' }], answer: 0, hint: '부엌에서 쓰는 거예요 🍲', why: '맞아요! 국이랑 나물을 맛있게 해 줘요.' },
    QZ_GOCHUJANG_1: { q: '고추장에 들어가지 않는 것은 무엇일까요?', choices: [{ e: '🌶️', t: '고춧가루' }, { e: '🍚', t: '찹쌀' }, { e: '🥛', t: '우유' }], answer: 2, hint: '하얗고 소한테서 나와요 🐄', why: '맞아요! 고추장에는 우유가 안 들어가요.' },
    QZ_GOCHUJANG_2: { q: '고춧가루는 어떻게 만들까요?', choices: [{ e: '☀️', t: '고추를 말려서 빻아요' }, { e: '🧊', t: '고추를 꽁꽁 얼려요' }], answer: 0, hint: '햇볕에 바싹 말려요 ☀️', why: '빨간 고추를 말려서 빻으면 고춧가루가 돼요!' },
    QZ_KIMCHI_1: { q: '김치를 새콤하게 만드는 친구는 누구일까요?', choices: [{ e: '🦠', t: '젖산균' }, { e: '🐸', t: '개구리' }, { e: '🦋', t: '나비' }], answer: 0, hint: '눈에 안 보이는 작은 친구예요 🦠', why: '젖산균이 김치를 새콤하게 만들어요!' },
    QZ_KIMCHI_2: { q: '겨울이 오기 전에 다 같이 김치를 담그는 일은?', choices: [{ e: '🥬', t: '김장' }, { e: '🎂', t: '생일 잔치' }, { e: '🎄', t: '성탄절' }], answer: 0, hint: '김치의 "김"으로 시작해요 🥬', why: '맞아요! 김장이에요. 이웃이랑 나눠 먹어요.' },
    QZ_KIMCHI_3: { q: '김치는 서늘한 곳에 두면 천천히 익어요. 맞을까요?', ox: true, answer: true, hint: '냉장고를 떠올려 봐요 🧊', why: '맞아요! 따뜻하면 빨리, 서늘하면 천천히 익어요.' },
    QZ_FARMING_1: { q: '24절기는 무엇을 보고 나눴을까요?', choices: [{ e: '🌞', t: '해님' }, { e: '🌊', t: '바닷물' }, { e: '⭐', t: '별 개수' }], answer: 0, hint: '하늘에서 반짝 빛나고 따뜻해요 🌞', why: '해님의 움직임을 보고 나눴어요!' },
    QZ_FARMING_2: { q: '낮이 가장 긴 날은 언제일까요?', choices: [{ e: '☀️', t: '하지' }, { e: '⛄', t: '동지' }], answer: 0, hint: '여름에 있어요 ☀️', why: '하지는 낮이 제일 길고, 동지는 밤이 제일 길어요!' },
    QZ_FARMING_3: { q: '마을 사람들이 다 같이 농사짓던 모임은?', choices: [{ e: '🤝', t: '두레' }, { e: '🏫', t: '서당' }], answer: 0, hint: '서로 돕는 모임이에요 🤝', why: '맞아요! 두레라고 해요.' },
    QZ_TOOLS_1: { q: '등에 메고 짐을 나르는 도구는 무엇일까요?', choices: [{ e: '🪵', t: '지게' }, { e: '🪨', t: '맷돌' }, { e: '🧺', t: '키' }], answer: 0, hint: '나무로 만들고 등에 메요 🎒', why: '지게예요! 무거운 짐도 거뜬해요.' },
    QZ_TOOLS_2: { q: '빙글빙글 돌려서 콩을 가는 돌은 무엇일까요?', choices: [{ e: '🪨', t: '맷돌' }, { e: '⛏️', t: '호미' }], answer: 0, hint: '돌 두 개가 겹쳐 있어요 🪨', why: '맷돌이에요! 빙글빙글 돌려서 갈아요.' },
    QZ_TOOLS_3: { q: '곡식을 까불러 껍질을 날리는 도구는 무엇일까요?', choices: [{ e: '🧺', t: '키' }, { e: '🍲', t: '시루' }, { e: '🥣', t: '절구' }], answer: 0, hint: '넓적하고 위아래로 흔들어요 🧺', why: '키예요! 가벼운 껍질이 훨훨 날아가요.' },
  };
  const KID_EXHIBIT = {
    EXH_DOENJANG: '구수한 된장이에요. 된장찌개를 끓일 때 써요 🍲',
    EXH_GANJANG: '까만 간장이에요. 음식을 알맞게 짭짤하게 해 줘요 🫙',
    EXH_GOCHUJANG: '맵고 달콤한 빨간 고추장이에요. 비빔밥에 넣어요 🌶️',
    EXH_KIMCHI: '새콤한 김치예요. 배추에 빨간 양념을 발라 익혀요 🥬',
    EXH_VINEGAR: '새콤한 식초예요. 술이 한 번 더 익어서 돼요 🍶',
  };
  const KID_FLOORS = {
    '3F': '높은 곳에서 밭이랑 장독대를 내려다봐요 🏔️',
    '2F': '메주랑 김치 만드는 걸 배워요 🧑‍🏫',
    '1F': '맛있는 장이랑 옹기를 구경해요 🏺',
  };
  for (const [id, k] of Object.entries(KID_EDU)) if (G.data.education[id]) G.data.education[id].kid = k;
  for (const [id, k] of Object.entries(KID_QUIZ)) if (G.data.quizzes[id]) G.data.quizzes[id].kid = k;
  for (const [id, t] of Object.entries(KID_EXHIBIT)) if (G.data.exhibitInfo[id]) G.data.exhibitInfo[id].kid = t;
  for (const f of G.data.hallGuide.floors) if (KID_FLOORS[f.floor]) f.kid = KID_FLOORS[f.floor];
  G.data.hallGuide.kidIntro = '체험관에는 세 층이 있어요. 층을 눌러 구경해요!';
})();
