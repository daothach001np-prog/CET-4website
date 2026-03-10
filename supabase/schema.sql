-- CET-4 distance coaching schema (Supabase/PostgreSQL)
-- Re-runnable (idempotent)

create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('student', 'teacher');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter type public.app_role add value if not exists 'teammate';
exception when others then null;
end $$;

do $$
begin
  create type public.task_module as enum ('reading', 'translation', 'writing', 'listening', 'mock');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.review_state as enum ('pending', 'returned', 'passed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.calendar_mark_kind as enum ('ring', 'done', 'missed');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  login_email text,
  is_admin boolean not null default false,
  role public.app_role not null default 'student',
  created_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists login_email text;

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  study_date date not null,
  module public.task_module not null,
  content text not null,
  word_summary text not null default '',
  mistake_summary text not null default '',
  image_urls text[] not null default '{}',
  review_status public.review_state not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, study_date, module)
);

alter table public.submissions
  add column if not exists image_urls text[] not null default '{}';

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  score int not null check (score between 0 and 100),
  status public.review_state not null default 'passed',
  comment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fines (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  fine_date date not null,
  amount int not null check (amount in (10, 20)),
  reason text not null,
  violation_count int not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (student_id, fine_date)
);

create table if not exists public.daily_reflections (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  reflection_date date not null,
  focus text not null default '',
  content text not null check (char_length(trim(content)) > 0 and char_length(content) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, reflection_date)
);

create table if not exists public.reflection_comments (
  id uuid primary key default gen_random_uuid(),
  reflection_id uuid not null unique references public.daily_reflections(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  comment text not null check (char_length(trim(comment)) > 0 and char_length(comment) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.image_annotations (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  source_image_url text not null,
  annotated_image_url text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.translation_prompts (
  id uuid primary key default gen_random_uuid(),
  year int,
  paper_code text not null default '',
  prompt_no int not null default 1,
  title text not null default '',
  source_text text not null check (char_length(trim(source_text)) > 0 and char_length(source_text) <= 4000),
  reference_text text not null default '',
  tags text[] not null default '{}',
  difficulty text not null default 'normal',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, paper_code, prompt_no)
);

create table if not exists public.translation_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  prompt_id uuid references public.translation_prompts(id) on delete set null,
  source_text text not null check (char_length(trim(source_text)) > 0 and char_length(source_text) <= 4000),
  reference_text text not null default '',
  student_text text not null default '',
  ocr_text text not null default '',
  final_text text not null check (char_length(trim(final_text)) > 0 and char_length(final_text) <= 8000),
  ai_score numeric(5,2),
  ai_feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.translation_reviews (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references public.translation_attempts(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  score int not null check (score between 0 and 100),
  comment text not null check (char_length(trim(comment)) > 0 and char_length(comment) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 1000),
  created_at timestamptz not null default now()
);

alter table public.messages
  add column if not exists recipient_id uuid references public.profiles(id) on delete cascade;

alter table public.messages
  add column if not exists event_type text not null default 'info';

alter table public.messages
  add column if not exists link_page text not null default '';

alter table public.messages
  add column if not exists related_submission_id uuid references public.submissions(id) on delete set null;

alter table public.messages
  add column if not exists related_review_id uuid references public.reviews(id) on delete set null;

alter table public.messages
  add column if not exists read_at timestamptz;

create table if not exists public.calendar_marks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  mark_date date not null,
  kind public.calendar_mark_kind not null default 'ring',
  note text not null default '',
  marked_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, mark_date)
);

insert into public.translation_prompts (
  year, paper_code, prompt_no, title, source_text, reference_text, tags, difficulty
)
values
  (
    2025,
    '2025-12-S3',
    1,
    '中国政府十分重视绿色经济的发展',
    '中国政府十分重视绿色经济的发展。通过加强森林资源保护、加大污染治理力度等一系列措施,许多地区的生态环境得到了显著改善。绿水青山(lucid waters and lush mountains)促进了当地的旅游、健康等产业的发展,创造了可观的经济效益。如今,生态环境与人类社会和谐共存的观念在中国已深入人心。绿色经济的推进不仅能为中国可持续发展做出贡献,也为全球环境保护提供了宝贵经验。',
    'The Chinese government places great emphasis on the development of the green economy. Through a series of measures, such as strengthening the protection of forest resources and intensifying pollution control, the ecological environment in many regions has been significantly improved.Lucid waters and lush mountains have boosted the growth of local industries like tourism and healthcare,generating substantial economic benefits. Today,the concept of harmonious coexistence between the ecological environment and human society has taken deep root in China. The advancement of the green economy not only contributes to China''s sustainable development but also provides valuable experience for global environmental protection.',
    array['cet4', '2025-12', 'set3'],
    'normal'
  ),
  (
    2025,
    '2025-12-S2',
    1,
    '近年来,城市漫步city walk在...',
    '近年来,"城市漫步(city walk)"在中国的年轻人中悄然兴起,已成为一种旅游新潮流。与传统旅游不同,城市漫步不追求在短时间内游览尽可能多的景点,而是随意行走或按照主题路线漫步在城市的大街小巷。漫步者品尝地道小吃,欣赏特色建筑,了解当地生活方式。他们还用相机或手机记录城市的风景和人物。这种旅游方式能让城市漫步者更深入了解城市的历史与文化。',
    'In recent years, "city walk" has quietly emerged among young people in China, becoming a new travel trend. Unlike traditional tourism,city walk does not aim to visit as many attractions as possible in a short period. Instead,it involves strolling casually or following themed routes through the streets and alleys of a city. Walkers sample local snacks,admire distinctive architecture,and learn about the local way of life. They also capture the city''s scenery and people with cameras or smartphones. This form of travel allows city walkers to gain a deeper understanding of the city''s history and culture.',
    array['cet4', '2025-12', 'set2'],
    'normal'
  ),
  (
    2025,
    '2025-12-S1',
    1,
    '近年来,中国政府高度重视民营经济pr...',
    '近年来,中国政府高度重视民营经济(private economy)的发展,出台了一系列政策支持民营企业。截至2025年3月底,全国民营企业数量超过5700万家,占企业总量的92.3%民营企业不仅数量稳步增长,质量和结构也在不断提升。民营企业的研发投入不断增加,在新一代信息技术、人工智能等领域发展迅速。民营企业核心竞争力的增强为中国经济的高质量发展提供了有力支撑。',
    'In recent years,the Chinese government has attached great importance to the development of the private economy and introduced a series of policies to support private enterprises. As of the end of March 2025,the number of private enterprises nationwide has exceeded 57 million,accounting for 92.3% of the total number. Private enterprises have achieved not only steady growth in quantity but also continuous improvement in quality and structure. With increasing investment in research and development, private enterprises have expanded rapidly in fields such as new-generation information technology and artificial intelligence. The enhanced core competitiveness of private enterprises has provided strong support for China''s high-quality economic development.',
    array['cet4', '2025-12', 'set1'],
    'normal'
  ),
  (
    2025,
    '2025-06-S3',
    1,
    '近年来,中国越来越多的城市着力打造1...',
    '近年来,中国越来越多的城市着力打造"15分钟便民生活圈(convenient living circles) "。社区居民步行 15分钟就能享受到日常所需的公共服务。生活圈内建有便利店、公园、健身场地、图书馆、学校、社区食堂、诊所等。生活圈的建立能够为居民提供更加便利、舒适、友好、愉悦的生活环境,更好地满足城市居民多元化的日常生活服务需求,提升居民的生活品质和幸福感。',
    '',
    array['cet4', '2025-06', 'set3'],
    'normal'
  ),
  (
    2025,
    '2025-06-S2',
    1,
    '近年来,中国东北地区正在大力开发冰雪...',
    '近年来,中国东北地区正在大力开发冰雪资源。例如,哈尔滨利用丰富的冰雪资源打造了极具地方特色的"冰雪大世界",让游客在欣赏冰雪之美的同时也能体验当地独特的民俗文化。如今,曾令人畏惧的冰天雪地正吸引着四面八方的游客,成为深受欢迎的旅游胜地。冰雪旅游业正为当地的经济发展做出越来越大的贡献。',
    '',
    array['cet4', '2025-06', 'set2'],
    'normal'
  ),
  (
    2025,
    '2025-06-S1',
    1,
    '杂交水稻 hybrid rice 之...',
    '杂交水稻 (hybrid rice) 之父"的袁隆平和他的科研团队克服重重困难,研发出了一种超级被誉为"杂交水稻。这项技术获得了举世公认的巨大成功。通过这项技术的应用,水稻抗旱抗病能力更强,能适应不同的气候和土壤条件,产量可提高20-30%。超级杂交水稻营养丰富,口感更佳。目前,这项技术已经在许多国家得到广泛应用,为全球粮食安全做出了重大贡献。',
    '',
    array['cet4', '2025-06', 'set1'],
    'normal'
  ),
  (
    2024,
    '2024-12-S3',
    1,
    '敦煌莫高窟 Mogao Grotto...',
    '敦煌莫高窟 (Mogao Grottoes) 数字展示中心于2014年开放启用,是莫高窟保护利用工程的重要组成部分。展示中心采用数字技术和多媒体展示手段,使游客进入洞窟参观之前就能了解莫高窟的历史文化,鉴赏莫高窟的艺术经典。这将减少开放洞窟的数量,缩短游客在洞窟内的逗留时间,减轻参观对莫高窟造成的影响,以使这一世界文化遗产得到妥善保护、长久利用。',
    '',
    array['cet4', '2024-12', 'set3'],
    'normal'
  ),
  (
    2024,
    '2024-12-S2',
    1,
    '近年来,中国新能源汽车产业发展迅速',
    '近年来,中国新能源汽车产业发展迅速。 目前,中国新能源汽车年产量已高达近千万辆,占全球市场份额超过60%, 出口量不断创出新高。中国政府通过加大资金投入和政策引导,鼓励新能源汽车企业进行技术创新,不断提高产品在市场上的竞争力。中国新能源汽车产业的发展不仅有力推动了国内经济发展,也为全球新能源利用和环境保护做出了积极贡献。',
    '',
    array['cet4', '2024-12', 'set2'],
    'normal'
  ),
  (
    2024,
    '2024-12-S1',
    1,
    '中国政府十分重视环境保护',
    '中国政府十分重视环境保护。近年来,中国在减少空气、水和土壤污染上取得了显著成效。为了不断改善人们的生活环境,中国采取了一系列有效措施,包括大力发展清洁能源,改善公共交通,推广共享单车,实施垃圾分类。通过这些措施,中国的城市和农村正在绿起来、美起来。中国还积极参与国际合作,为全球环境保护做出了重要贡献。',
    '',
    array['cet4', '2024-12', 'set1'],
    'normal'
  ),
  (
    2024,
    '2024-06-S3',
    1,
    '汉语中的福字the characte...',
    '汉语中的"福"字(the character fu)表示幸福和好运,是中国传统文化中最常用的吉祥(auspicious符号之一。人们通常将一个大大的福字写在红纸上,寓意期盼家庭幸福、社会安定、国家昌盛。春节贴福字是民间由来已久的习俗。为了欢庆春节,家家户户都会将福字贴在门上或墙上,表达对幸福生活的向往、对美好未来的期待。人们有时还将福字倒过来贴,表示幸福已到、好运已到。',
    '',
    array['cet4', '2024-06', 'set3'],
    'normal'
  ),
  (
    2024,
    '2024-06-S2',
    1,
    '农历the lunar calend...',
    '农历(the lunar calendar)起源于数千年前的中国,根据太阳和月亮的运行规律制定。长期以来,农历在农业生产和人们日常生活中发挥着重要作用。古人依据农历记录日期、安排农活,以便最有效地利用自然资源和气候条件,提高农作物的产量和质量。中国的春节、中秋节等传统节日的日期都基于农历。农历是中国传统文化的重要组成部分,当今依然广为使用。',
    '',
    array['cet4', '2024-06', 'set2'],
    'normal'
  ),
  (
    2024,
    '2024-06-S1',
    1,
    '四合院siheyuan 是中国一种传...',
    '四合院(siheyuan) 是中国一种传统的住宅建筑,其特点是房屋建造在一个院子的四周,将院子合围在中间。四合院通常冬暖夏凉,环境舒适,尤其适合大家庭居住。四合院在中国各地有多种类型,其中以北京的四合院最为典型。如今,随着现代城市的发展,传统的四合院已逐渐减少,但因其独特的建筑风格,四合院对中国文化的传承和中国历史的研究具有重要意义。',
    '',
    array['cet4', '2024-06', 'set1'],
    'normal'
  ),
  (
    2023,
    '2023-12-S3',
    1,
    '改革开放以来,中国人民生活水平不断提...',
    '改革开放以来,中国人民生活水平不断提高,这在人们的饮食(diet)变化上得到充分体现。如今,人们不再满足于吃得饱,而是追求吃得更加安全、更加营养、更加健康,食物也愈来愈丰富多样,不再限于本地的农产品。物流业(logistics industry)的发展使人们很容易品尝到全国各地的特产。毫无疑问,食品质量与饮食结构的改善为增进人们健康提供了有力的保障。',
    '',
    array['cet4', '2023-12', 'set3'],
    'normal'
  ),
  (
    2023,
    '2023-12-S2',
    1,
    '改革开放以来,中国人的饮食diet发...',
    '改革开放以来,中国人的饮食(diet)发生了显著变化。过去由于经济落后,食品种类有限、数量不足,人们仅仅满足于吃得饱。如今中国经济快速发展,食品不仅更加丰富多样,质量也大幅提高。随着生活水平不断提升,人们对饮食的要求越来越高,更加注重吃得营养健康。因此,目前市场上推出的低脂、低糖、有机食品受到人们的普遍欢迎。',
    '',
    array['cet4', '2023-12', 'set2'],
    'normal'
  ),
  (
    2023,
    '2023-12-S1',
    1,
    '中国政府十分重视人民的健康饮食die...',
    '中国政府十分重视人民的健康饮食(diet)。通过大力提倡健康饮食,人们对合理营养增进健康的重要性有了更加深刻的认识。"吃得安全、吃得营养、吃得健康"是人民对美好生活的基本需要,是提升人民幸福感的必然要求,也为食品产业的发展提供了新机遇。目前,各级政府都在采取多种举措确保人民饮食健康,推进健康中国的建设。',
    '',
    array['cet4', '2023-12', 'set1'],
    'normal'
  ),
  (
    2023,
    '2023-06-S3',
    1,
    '中国政府一直大力推行义务教育comp...',
    '中国政府一直大力推行义务教育(compulsory education),以使每个儿童都享有受教育的机会。自 1986 年《义务教育法》生效以来,经过不懈努力,实现了在全国推行义务教育的目标。如今,在中国,儿童年满六周岁开始上小学,从小学到初中一共接受九年义务教育。从 2008 年秋季学期开始,义务教育阶段学生无须缴纳学费。随着一系列教育改革举措的实施,中国义务教育的质量也有显著提高。',
    '',
    array['cet4', '2023-06', 'set3'],
    'normal'
  ),
  (
    2023,
    '2023-06-S2',
    1,
    '改革开放 40 多年以来,中国政府对...',
    '改革开放 40 多年以来,中国政府对高等教育越来越重视,高等教育已经进入稳步发展阶段。高校学生总数已接近 4,700 万人,位居世界第一。随着我国经济的快速发展,人民生活水平不断提高,越来越多的人渴望接受高等教育。我国高校的数量和学科专业持续增加,招生人数逐年上升,教学质量也在不断改进,为更多年轻人创造了接受高等教育的机会。',
    '',
    array['cet4', '2023-06', 'set2'],
    'normal'
  ),
  (
    2023,
    '2023-06-S1',
    1,
    '中国越来越重视终身教育,发展继续教育...',
    '中国越来越重视终身教育,发展继续教育是构建终身教育体系的有效途径。高校作为人才培养的基地,拥有先进的教学理念和优越的教学资源,理应成为继续教育的办学主体。因此,近年来许多高校适应社会需求,加强与用人单位沟通,努力探索一条符合中国国情的继续教育发展新路,以使继续教育在国家发展战略中发挥更大的作用。',
    '',
    array['cet4', '2023-06', 'set1'],
    'normal'
  ),
  (
    2023,
    '2023-03-S3',
    1,
    '近年来,越来越多的城市居民为农村的田...',
    '近年来,越来越多的城市居民为农村的田园风光所吸引,利用节假日到乡村旅游。他们住在农民家中,品尝具有当地风味的农家饭菜。有些游客还参与采摘瓜果等活动,亲身感受收获的喜悦。乡村旅游能够有效地帮助游客舒缓压力,放松心情,增进身心健康。实际上,这种旅游形式不仅能使城市游客受益,同时也能增加农民的收入,促进农村经济发展。',
    '',
    array['cet4', '2023-03', 'set3'],
    'normal'
  ),
  (
    2023,
    '2023-03-S2',
    1,
    '随着生活水平的提高,更多人开始加入到...',
    '随着生活水平的提高,更多人开始加入到自驾游的行列之中。自驾游者既可驾驶自家车也可借车或租车出游。司机可能是车主或结伴出游者。自驾游与传统的组团旅游不同,它能够更好地满足旅游者的个性化需求,使他们更好地享受旅游的过程。自驾游尤其受到年轻出游者的欢迎。年轻人追求独立自由的生活,而自驾游恰好满足了他们的这一需求。',
    '',
    array['cet4', '2023-03', 'set2'],
    'normal'
  ),
  (
    2023,
    '2023-03-S1',
    1,
    '近年来,越来越多的年轻人喜爱各种形式...',
    '近年来,越来越多的年轻人喜爱各种形式的自助旅游。许多自助旅游者选择徒步或骑自行车出游。他们自己设计路线,自带帐篷、厨具以及其他必备的生活用品。在旅途中,自助旅游者经常能够发现一些新的美丽景点,但有时也会遇见意想不到的困难或突发事件。游客在旅行中拥抱自然、欣赏美景,同时也增强了自己克服困难的勇气和野外生存的能力。',
    '',
    array['cet4', '2023-03', 'set1'],
    'normal'
  )
on conflict (year, paper_code, prompt_no) do update
set
  title = excluded.title,
  source_text = excluded.source_text,
  reference_text = excluded.reference_text,
  tags = excluded.tags,
  difficulty = excluded.difficulty;


create index if not exists idx_submissions_student_date on public.submissions (student_id, study_date desc);
create index if not exists idx_submissions_created_at on public.submissions (created_at desc);
create index if not exists idx_reviews_submission_id on public.reviews (submission_id);
create index if not exists idx_fines_student_date on public.fines (student_id, fine_date desc);
create index if not exists idx_reflections_student_date on public.daily_reflections (student_id, reflection_date desc);
create index if not exists idx_reflection_comments_reflection_id on public.reflection_comments (reflection_id);
create index if not exists idx_image_annotations_submission_id on public.image_annotations (submission_id, created_at desc);
create index if not exists idx_calendar_marks_student_date on public.calendar_marks (student_id, mark_date desc);
create index if not exists idx_translation_prompts_year_code on public.translation_prompts (year desc, paper_code desc, prompt_no asc);
create index if not exists idx_translation_attempts_student_created on public.translation_attempts (student_id, created_at desc);
create index if not exists idx_translation_attempts_prompt on public.translation_attempts (prompt_id);
create index if not exists idx_translation_reviews_attempt_id on public.translation_reviews (attempt_id);
create index if not exists idx_messages_created_at on public.messages (created_at asc);
create index if not exists idx_messages_recipient_created on public.messages (recipient_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_submissions_touch_updated_at on public.submissions;
create trigger trg_submissions_touch_updated_at
before update on public.submissions
for each row execute function public.touch_updated_at();

drop trigger if exists trg_reviews_touch_updated_at on public.reviews;
create trigger trg_reviews_touch_updated_at
before update on public.reviews
for each row execute function public.touch_updated_at();

drop trigger if exists trg_reflections_touch_updated_at on public.daily_reflections;
create trigger trg_reflections_touch_updated_at
before update on public.daily_reflections
for each row execute function public.touch_updated_at();

drop trigger if exists trg_reflection_comments_touch_updated_at on public.reflection_comments;
create trigger trg_reflection_comments_touch_updated_at
before update on public.reflection_comments
for each row execute function public.touch_updated_at();

drop trigger if exists trg_calendar_marks_touch_updated_at on public.calendar_marks;
create trigger trg_calendar_marks_touch_updated_at
before update on public.calendar_marks
for each row execute function public.touch_updated_at();

drop trigger if exists trg_translation_prompts_touch_updated_at on public.translation_prompts;
create trigger trg_translation_prompts_touch_updated_at
before update on public.translation_prompts
for each row execute function public.touch_updated_at();

drop trigger if exists trg_translation_attempts_touch_updated_at on public.translation_attempts;
create trigger trg_translation_attempts_touch_updated_at
before update on public.translation_attempts
for each row execute function public.touch_updated_at();

drop trigger if exists trg_translation_reviews_touch_updated_at on public.translation_reviews;
create trigger trg_translation_reviews_touch_updated_at
before update on public.translation_reviews
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, login_email)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.sync_user_email_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set login_email = new.email
  where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated
after update of email on auth.users
for each row execute function public.sync_user_email_to_profile();

update public.profiles p
set login_email = u.email
from auth.users u
where u.id = p.id
  and p.login_email is distinct from u.email;

create or replace function public.is_teacher(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid and p.role = 'teacher'
  );
$$;

create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid and p.is_admin = true
  );
$$;

create or replace function public.is_reviewer(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = uid and (p.role::text in ('teacher', 'teammate') or p.is_admin = true)
  );
$$;

create or replace function public.claim_teacher_role()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  teacher_count int;
  admin_count int;
  out_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into out_profile
  from public.profiles
  where id = auth.uid();

  if out_profile.id is null then
    raise exception 'Profile not found';
  end if;

  if out_profile.role = 'teacher' then
    return out_profile;
  end if;

  select count(*) into teacher_count
  from public.profiles
  where role = 'teacher';

  select count(*) into admin_count
  from public.profiles
  where is_admin = true;

  if teacher_count > 0 then
    raise exception 'Teacher already exists';
  end if;

  update public.profiles
  set
    role = 'teacher',
    is_admin = case when admin_count = 0 then true else is_admin end
  where id = auth.uid()
  returning * into out_profile;

  return out_profile;
end;
$$;

create or replace function public.set_user_role(p_user uuid, p_role public.app_role)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  old_role public.app_role;
  teacher_count int;
  out_profile public.profiles;
begin
  if not (public.is_teacher(auth.uid()) or public.is_admin(auth.uid())) then
    raise exception 'Only teacher/admin can set role';
  end if;

  select role into old_role
  from public.profiles
  where id = p_user;

  if old_role is null then
    raise exception 'User profile not found';
  end if;

  if old_role = 'teacher' and p_role = 'student' then
    select count(*) into teacher_count
    from public.profiles
    where role = 'teacher';
    if teacher_count <= 1 then
      raise exception 'Cannot demote the last teacher';
    end if;
  end if;

  update public.profiles
  set role = p_role
  where id = p_user
  returning * into out_profile;

  return out_profile;
end;
$$;

create or replace function public.set_profile_label(p_user uuid, p_full_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  out_profile public.profiles;
begin
  if not (public.is_teacher(auth.uid()) or public.is_admin(auth.uid())) then
    raise exception 'Only teacher/admin can set profile label';
  end if;

  update public.profiles
  set full_name = coalesce(trim(p_full_name), '')
  where id = p_user
  returning * into out_profile;

  if out_profile.id is null then
    raise exception 'User profile not found';
  end if;

  return out_profile;
end;
$$;

create or replace function public.claim_admin_role()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  admin_count int;
  out_profile public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into out_profile
  from public.profiles
  where id = auth.uid();

  if out_profile.id is null then
    raise exception 'Profile not found';
  end if;

  if out_profile.role <> 'teacher' then
    raise exception 'Only teacher can claim admin role';
  end if;

  if out_profile.is_admin then
    return out_profile;
  end if;

  select count(*) into admin_count
  from public.profiles
  where is_admin = true;

  if admin_count > 0 then
    raise exception 'Admin already exists';
  end if;

  update public.profiles
  set is_admin = true
  where id = auth.uid()
  returning * into out_profile;

  return out_profile;
end;
$$;

create or replace function public.module_label(p_module public.task_module)
returns text
language sql
immutable
as $$
  select case p_module
    when 'reading' then '阅读'
    when 'translation' then '翻译'
    when 'writing' then '写作'
    when 'listening' then '听力'
    when 'mock' then '模拟考'
    else p_module::text
  end;
$$;

create or replace function public.push_message(
  p_recipient uuid,
  p_body text,
  p_sender uuid,
  p_event_type text default 'info',
  p_link_page text default '',
  p_submission uuid default null,
  p_review uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  out_id uuid;
begin
  if p_recipient is null or coalesce(trim(p_body), '') = '' then
    return null;
  end if;

  insert into public.messages (
    sender_id,
    recipient_id,
    body,
    event_type,
    link_page,
    related_submission_id,
    related_review_id
  )
  values (
    p_sender,
    p_recipient,
    left(trim(p_body), 1000),
    coalesce(nullif(trim(p_event_type), ''), 'info'),
    coalesce(p_link_page, ''),
    p_submission,
    p_review
  )
  returning id into out_id;

  return out_id;
end;
$$;

create or replace function public.notify_submission_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reviewer record;
  sender_name text;
  action_name text;
  target_page text;
begin
  if auth.uid() is null or auth.uid() <> new.student_id then
    return new;
  end if;

  select coalesce(nullif(full_name, ''), login_email, '学生')
  into sender_name
  from public.profiles
  where id = new.student_id;

  action_name := case when tg_op = 'INSERT' then '提交了' else '更新了' end;

  for reviewer in
    select id, role, is_admin
    from public.profiles
    where id <> new.student_id
      and (role::text in ('teacher', 'teammate') or is_admin = true)
  loop
    target_page := case
      when reviewer.role = 'teammate' then 'teammate-review'
      else 'teacher-review'
    end;

    perform public.push_message(
      reviewer.id,
      sender_name || action_name || new.study_date || ' 的' || public.module_label(new.module) || '作业。',
      new.student_id,
      'submission',
      target_page,
      new.id,
      null
    );
  end loop;

  return new;
end;
$$;

create or replace function public.notify_review_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_row public.submissions;
  teacher_name text;
  action_name text;
  target_page text;
begin
  select *
  into submission_row
  from public.submissions
  where id = new.submission_id;

  if submission_row.id is null then
    return new;
  end if;

  select coalesce(nullif(full_name, ''), login_email, '老师')
  into teacher_name
  from public.profiles
  where id = new.teacher_id;

  action_name := case when tg_op = 'INSERT' then '已批改' else '更新了批改' end;
  target_page := case
    when exists (
      select 1
      from public.profiles p
      where p.id = submission_row.student_id
        and p.role = 'teammate'
    ) then 'teammate-history'
    else 'student-history'
  end;

  perform public.push_message(
    submission_row.student_id,
    teacher_name || action_name || submission_row.study_date || ' 的' || public.module_label(submission_row.module) || '作业。',
    new.teacher_id,
    'review',
    target_page,
    submission_row.id,
    new.id
  );

  return new;
end;
$$;

create or replace function public.required_modules_for_day(p_day date)
returns public.task_module[]
language plpgsql
immutable
as $$
declare
  mods public.task_module[] := array['reading'::public.task_module, 'listening'::public.task_module];
begin
  if mod(extract(doy from p_day)::int, 2) = 0 then
    mods := array_append(mods, 'translation'::public.task_module);
  end if;

  if extract(dow from p_day)::int = 6 then
    mods := mods || array['writing'::public.task_module, 'mock'::public.task_module];
  end if;

  return mods;
end;
$$;

create or replace function public.audit_student_day(p_student uuid, p_day date)
returns public.fines
language plpgsql
security definer
set search_path = public
as $$
declare
  required_modules public.task_module[] := public.required_modules_for_day(p_day);
  missing_modules public.task_module[];
  previous_count int;
  fine_row public.fines;
begin
  if not public.is_teacher(auth.uid()) then
    raise exception 'Only teacher can run audit.';
  end if;

  select f.* into fine_row
  from public.fines f
  where f.student_id = p_student and f.fine_date = p_day;

  if fine_row.id is not null then
    return fine_row;
  end if;

  select array_agg(m) into missing_modules
  from unnest(required_modules) as m
  where not exists (
    select 1
    from public.submissions s
    where s.student_id = p_student
      and s.study_date = p_day
      and s.module = m
  );

  if missing_modules is null or array_length(missing_modules, 1) is null then
    return null;
  end if;

  select count(*) into previous_count
  from public.fines f
  where f.student_id = p_student;

  insert into public.fines (
    student_id, fine_date, amount, reason, violation_count, created_by
  )
  values (
    p_student,
    p_day,
    case when previous_count = 0 then 10 else 20 end,
    'missing modules: ' || array_to_string(missing_modules::text[], ', '),
    previous_count + 1,
    auth.uid()
  )
  returning * into fine_row;

  return fine_row;
end;
$$;

create or replace function public.audit_all_students(p_day date)
returns setof public.fines
language plpgsql
security definer
set search_path = public
as $$
declare
  stu record;
  fine_row public.fines;
begin
  if not public.is_teacher(auth.uid()) then
    raise exception 'Only teacher can run audit.';
  end if;

  for stu in
    select p.id
    from public.profiles p
    where p.role = 'student'
  loop
    fine_row := public.audit_student_day(stu.id, p_day);
    if fine_row.id is not null then
      return next fine_row;
    end if;
  end loop;
  return;
end;
$$;

drop trigger if exists trg_submissions_notify_message on public.submissions;
create trigger trg_submissions_notify_message
after insert or update of content, word_summary, mistake_summary, image_urls
on public.submissions
for each row execute function public.notify_submission_message();

drop trigger if exists trg_reviews_notify_message on public.reviews;
create trigger trg_reviews_notify_message
after insert or update of score, status, comment
on public.reviews
for each row execute function public.notify_review_message();

alter table public.profiles enable row level security;
alter table public.submissions enable row level security;
alter table public.reviews enable row level security;
alter table public.fines enable row level security;
alter table public.daily_reflections enable row level security;
alter table public.reflection_comments enable row level security;
alter table public.image_annotations enable row level security;
alter table public.calendar_marks enable row level security;
alter table public.translation_prompts enable row level security;
alter table public.translation_attempts enable row level security;
alter table public.translation_reviews enable row level security;
alter table public.messages enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
create policy profiles_select_authenticated
on public.profiles
for select
to authenticated
using (true);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists submissions_insert_own on public.submissions;
create policy submissions_insert_own
on public.submissions
for insert
to authenticated
with check (student_id = auth.uid());

drop policy if exists submissions_select_own_or_teacher on public.submissions;
create policy submissions_select_own_or_teacher
on public.submissions
for select
to authenticated
using (student_id = auth.uid() or public.is_reviewer(auth.uid()));

drop policy if exists submissions_update_own_or_teacher on public.submissions;
create policy submissions_update_own_or_teacher
on public.submissions
for update
to authenticated
using (student_id = auth.uid() or public.is_reviewer(auth.uid()))
with check (student_id = auth.uid() or public.is_reviewer(auth.uid()));

drop policy if exists submissions_delete_admin on public.submissions;
create policy submissions_delete_admin
on public.submissions
for delete
to authenticated
using (public.is_admin(auth.uid()));

drop policy if exists reviews_select_teacher_or_owner on public.reviews;
create policy reviews_select_teacher_or_owner
on public.reviews
for select
to authenticated
using (
  public.is_reviewer(auth.uid())
  or exists (
    select 1
    from public.submissions s
    where s.id = reviews.submission_id
      and s.student_id = auth.uid()
  )
);

drop policy if exists reviews_insert_teacher on public.reviews;
create policy reviews_insert_teacher
on public.reviews
for insert
to authenticated
with check (public.is_reviewer(auth.uid()) and teacher_id = auth.uid());

drop policy if exists reviews_update_teacher on public.reviews;
create policy reviews_update_teacher
on public.reviews
for update
to authenticated
using (public.is_reviewer(auth.uid()))
with check (public.is_reviewer(auth.uid()));

drop policy if exists fines_select_teacher_or_owner on public.fines;
create policy fines_select_teacher_or_owner
on public.fines
for select
to authenticated
using (student_id = auth.uid() or public.is_reviewer(auth.uid()));

drop policy if exists fines_manage_teacher on public.fines;
create policy fines_manage_teacher
on public.fines
for all
to authenticated
using (public.is_teacher(auth.uid()))
with check (public.is_teacher(auth.uid()));

drop policy if exists reflections_select_own_or_teacher on public.daily_reflections;
create policy reflections_select_own_or_teacher
on public.daily_reflections
for select
to authenticated
using (student_id = auth.uid() or public.is_reviewer(auth.uid()));

drop policy if exists reflections_insert_own on public.daily_reflections;
create policy reflections_insert_own
on public.daily_reflections
for insert
to authenticated
with check (student_id = auth.uid());

drop policy if exists reflections_update_own on public.daily_reflections;
create policy reflections_update_own
on public.daily_reflections
for update
to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

drop policy if exists reflection_comments_select on public.reflection_comments;
create policy reflection_comments_select
on public.reflection_comments
for select
to authenticated
using (
  public.is_reviewer(auth.uid())
  or exists (
    select 1
    from public.daily_reflections r
    where r.id = reflection_comments.reflection_id
      and r.student_id = auth.uid()
  )
);

drop policy if exists reflection_comments_insert_teacher on public.reflection_comments;
create policy reflection_comments_insert_teacher
on public.reflection_comments
for insert
to authenticated
with check (public.is_reviewer(auth.uid()) and teacher_id = auth.uid());

drop policy if exists reflection_comments_update_teacher on public.reflection_comments;
create policy reflection_comments_update_teacher
on public.reflection_comments
for update
to authenticated
using (public.is_reviewer(auth.uid()))
with check (public.is_reviewer(auth.uid()));

drop policy if exists image_annotations_select on public.image_annotations;
create policy image_annotations_select
on public.image_annotations
for select
to authenticated
using (
  public.is_reviewer(auth.uid())
  or exists (
    select 1
    from public.submissions s
    where s.id = image_annotations.submission_id
      and s.student_id = auth.uid()
  )
);

drop policy if exists image_annotations_insert_teacher on public.image_annotations;
create policy image_annotations_insert_teacher
on public.image_annotations
for insert
to authenticated
with check (public.is_reviewer(auth.uid()) and teacher_id = auth.uid());

drop policy if exists image_annotations_update_teacher on public.image_annotations;
create policy image_annotations_update_teacher
on public.image_annotations
for update
to authenticated
using (public.is_reviewer(auth.uid()))
with check (public.is_reviewer(auth.uid()));

drop policy if exists image_annotations_delete_teacher on public.image_annotations;
create policy image_annotations_delete_teacher
on public.image_annotations
for delete
to authenticated
using (public.is_reviewer(auth.uid()));

drop policy if exists calendar_marks_select on public.calendar_marks;
create policy calendar_marks_select
on public.calendar_marks
for select
to authenticated
using (student_id = auth.uid() or public.is_reviewer(auth.uid()));

drop policy if exists calendar_marks_insert_reviewer on public.calendar_marks;
create policy calendar_marks_insert_reviewer
on public.calendar_marks
for insert
to authenticated
with check (public.is_reviewer(auth.uid()) and marked_by = auth.uid());

drop policy if exists calendar_marks_update_reviewer on public.calendar_marks;
create policy calendar_marks_update_reviewer
on public.calendar_marks
for update
to authenticated
using (public.is_reviewer(auth.uid()))
with check (public.is_reviewer(auth.uid()) and marked_by = auth.uid());

drop policy if exists calendar_marks_delete_reviewer on public.calendar_marks;
create policy calendar_marks_delete_reviewer
on public.calendar_marks
for delete
to authenticated
using (public.is_reviewer(auth.uid()));

drop policy if exists translation_prompts_select_authenticated on public.translation_prompts;
create policy translation_prompts_select_authenticated
on public.translation_prompts
for select
to authenticated
using (true);

drop policy if exists translation_prompts_insert_teacher on public.translation_prompts;
create policy translation_prompts_insert_teacher
on public.translation_prompts
for insert
to authenticated
with check (public.is_teacher(auth.uid()));

drop policy if exists translation_prompts_update_teacher on public.translation_prompts;
create policy translation_prompts_update_teacher
on public.translation_prompts
for update
to authenticated
using (public.is_teacher(auth.uid()))
with check (public.is_teacher(auth.uid()));

drop policy if exists translation_prompts_delete_teacher on public.translation_prompts;
create policy translation_prompts_delete_teacher
on public.translation_prompts
for delete
to authenticated
using (public.is_teacher(auth.uid()));

drop policy if exists translation_attempts_select on public.translation_attempts;
create policy translation_attempts_select
on public.translation_attempts
for select
to authenticated
using (student_id = auth.uid() or public.is_reviewer(auth.uid()));

drop policy if exists translation_attempts_insert_own on public.translation_attempts;
create policy translation_attempts_insert_own
on public.translation_attempts
for insert
to authenticated
with check (student_id = auth.uid());

drop policy if exists translation_attempts_update_own on public.translation_attempts;
create policy translation_attempts_update_own
on public.translation_attempts
for update
to authenticated
using (student_id = auth.uid())
with check (student_id = auth.uid());

drop policy if exists translation_attempts_delete_own_or_teacher on public.translation_attempts;
create policy translation_attempts_delete_own_or_teacher
on public.translation_attempts
for delete
to authenticated
using (student_id = auth.uid() or public.is_reviewer(auth.uid()));

drop policy if exists translation_reviews_select on public.translation_reviews;
create policy translation_reviews_select
on public.translation_reviews
for select
to authenticated
using (
  public.is_reviewer(auth.uid())
  or exists (
    select 1
    from public.translation_attempts a
    where a.id = translation_reviews.attempt_id
      and a.student_id = auth.uid()
  )
);

drop policy if exists translation_reviews_insert_teacher on public.translation_reviews;
create policy translation_reviews_insert_teacher
on public.translation_reviews
for insert
to authenticated
with check (public.is_reviewer(auth.uid()) and teacher_id = auth.uid());

drop policy if exists translation_reviews_update_teacher on public.translation_reviews;
create policy translation_reviews_update_teacher
on public.translation_reviews
for update
to authenticated
using (public.is_reviewer(auth.uid()))
with check (public.is_reviewer(auth.uid()) and teacher_id = auth.uid());

drop policy if exists translation_reviews_delete_teacher on public.translation_reviews;
create policy translation_reviews_delete_teacher
on public.translation_reviews
for delete
to authenticated
using (public.is_reviewer(auth.uid()));

drop policy if exists messages_select_authenticated on public.messages;
drop policy if exists messages_select_recipient_or_sender on public.messages;
create policy messages_select_recipient_or_sender
on public.messages
for select
to authenticated
using (recipient_id = auth.uid() or sender_id = auth.uid());

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own
on public.messages
for insert
to authenticated
with check (sender_id = auth.uid());

drop policy if exists messages_update_recipient on public.messages;
create policy messages_update_recipient
on public.messages
for update
to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- Storage buckets
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'submission-images',
  'submission-images',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'annotation-images',
  'annotation-images',
  true,
  8388608,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists submission_images_read on storage.objects;
create policy submission_images_read
on storage.objects
for select
to authenticated
using (bucket_id = 'submission-images');

drop policy if exists submission_images_insert_own on storage.objects;
create policy submission_images_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'submission-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists submission_images_update_own on storage.objects;
create policy submission_images_update_own
on storage.objects
for update
to authenticated
using (bucket_id = 'submission-images' and owner = auth.uid())
with check (bucket_id = 'submission-images' and owner = auth.uid());

drop policy if exists submission_images_delete_own on storage.objects;
create policy submission_images_delete_own
on storage.objects
for delete
to authenticated
using (bucket_id = 'submission-images' and owner = auth.uid());

drop policy if exists submission_images_delete_admin on storage.objects;
create policy submission_images_delete_admin
on storage.objects
for delete
to authenticated
using (bucket_id = 'submission-images' and public.is_admin(auth.uid()));

drop policy if exists annotation_images_read on storage.objects;
create policy annotation_images_read
on storage.objects
for select
to authenticated
using (bucket_id = 'annotation-images');

drop policy if exists annotation_images_insert_teacher on storage.objects;
create policy annotation_images_insert_teacher
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'annotation-images'
  and public.is_reviewer(auth.uid())
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists annotation_images_update_teacher on storage.objects;
create policy annotation_images_update_teacher
on storage.objects
for update
to authenticated
using (bucket_id = 'annotation-images' and owner = auth.uid())
with check (bucket_id = 'annotation-images' and owner = auth.uid());

drop policy if exists annotation_images_delete_teacher on storage.objects;
create policy annotation_images_delete_teacher
on storage.objects
for delete
to authenticated
using (bucket_id = 'annotation-images' and owner = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.is_teacher(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_reviewer(uuid) to authenticated;
grant execute on function public.claim_teacher_role() to authenticated;
grant execute on function public.claim_admin_role() to authenticated;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;
grant execute on function public.set_profile_label(uuid, text) to authenticated;
grant execute on function public.required_modules_for_day(date) to authenticated;
grant execute on function public.audit_student_day(uuid, date) to authenticated;
grant execute on function public.audit_all_students(date) to authenticated;

