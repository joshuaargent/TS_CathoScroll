import { Topic } from '@/types';

// ============================================================
// CATHOSCROLL CATEGORIES
// ============================================================

// God
// Jesus Christ
// The Church
// Scripture
// Prayer
// The Sacraments
// Mary & Saints
// Salvation
// Sin & Grace
// Moral Life
// Marriage & Family
// Life Issues
// Heaven, Hell & Purgatory
// Apologetics
// Science & Faith

// ============================================================
// CATHOSCROLL CONTENT GUIDELINES
// ============================================================

// Question
// Ideal: 8-20 words
// Maximum: 25 words
// One clear question only.
// Avoid combining multiple topics in a single question.

// Answer
// Ideal: 25-50 words
// Maximum: 75 words
// Give the direct Catholic teaching.
// Should be understandable on its own.

// Explanation
// Ideal: 120-220 words
// Maximum: 300 words
// Explain the doctrine, provide context, address common misconceptions,
// and show why it matters.
// If the explanation exceeds 300 words, strongly consider splitting
// the content into multiple topics.

// Catechism Text
// Ideal: 50-120 words
// Maximum: 180 words
// Use meaningful quotations from the Catechism of the Catholic Church.
// Prefer complete thoughts over isolated sentences.
// Include all relevant paragraph references.

// Scripture Text
// Ideal: 1 complete verse or short passage
// Maximum: 2-3 verses
// Always provide sufficient context.
// Avoid partial quotations where meaning may be unclear.

// Content Quality Standards
// - Remain strictly faithful to Catholic teaching.
// - Use the Penny Catechism question and answer where applicable.
// - Modernise explanations while preserving doctrine.
// - Prefer clarity over theological jargon.
// - Cite the strongest Catechism and Scripture references available.
// - One topic should teach one doctrine.
// - Split large subjects into multiple focused topics.
// - Write for mobile reading and scrolling.
// - Every topic should be understandable to a beginner.
// - Explanations should be engaging, educational, and accurate.
// - Avoid unnecessary repetition.
// - Aim for a total topic length of roughly 250-450 words.

export const topics: Topic[] = [
  {
    id: '1',

    slug: 'who-made-you',

    category: 'God',

    question: 'Who made you?',

    answer: 'God made me.',

    explanation:
      'This simple answer teaches one of the most important truths of the Catholic faith: we are not accidents. Every human person exists because God freely chose to create them. God knows each person, loves each person, and wills their existence. Because we are created by God, every human life possesses inherent dignity and value that cannot be taken away by success, failure, wealth, ability, or social status. Understanding that God made us helps us understand who we are and why we are here. We belong to God, depend upon Him for everything, and are called to live in a relationship with Him. Recognising God as our Creator should lead us to gratitude, humility, worship, and trust in His loving plan for our lives.',

    catechism: {
      paragraphs: ['1', '295', '355'],
      text: 'God created the world according to his wisdom and love. God created man in his own image, in the image of God he created him; male and female he created them. Of all visible creatures only man is able to know and love his creator.',
    },

    scripture: {
      reference: 'Genesis 1:27',
      text: 'So God created man in his own image, in the image of God he created him; male and female he created them.',
    },
  },
  {
    id: '2',

    slug: 'why-did-god-make-you',

    category: 'God',

    question: 'Why did God make you?',

    answer:
      'God made me to know him, love him and serve him in this world, and to be happy with him for ever in the next.',

    explanation:
      'This answer summarises the purpose of human life. God did not create us without purpose or direction. He created us so that we might enter into a relationship with Him. We come to know God through faith, prayer, Scripture, and the teaching of the Church. We show our love for God through worship, obedience, and charity towards others. We serve God by living according to His commandments and using our gifts for His glory. Earthly life is therefore a preparation for eternal life. While many people search for happiness in possessions, achievements, or pleasure, the deepest fulfilment of the human heart is found only in God. The goal of the Christian life is not merely to be a good person but to share forever in the life and happiness of God in Heaven.',

    catechism: {
      paragraphs: ['1', '27', '1721'],
      text: 'God, infinitely perfect and blessed in himself, freely created man to make him share in his own blessed life. The desire for God is written in the human heart because man is created by God and for God. God put us in the world to know, to love, and to serve him, and so to come to paradise.',
    },

    scripture: {
      reference: 'John 17:3',
      text: 'And this is eternal life, that they know you the only true God, and Jesus Christ whom you have sent.',
    },
  },
  {
    id: '3',

    slug: 'image-and-likeness-of-god',

    category: 'God',

    question: 'To whose image and likeness did God make you?',

    answer: 'God made me to his own image and likeness.',

    explanation:
      'Being made in the image and likeness of God gives every human person a unique dignity. Unlike animals and the rest of creation, human beings are capable of reason, free choice, love, and relationship with God. The image of God is present in every person from conception until natural death and is the foundation of human dignity. Although sin wounded humanity, it did not destroy this image. Through Jesus Christ, we are called not only to reflect God more clearly in this life but also to be transformed by grace and ultimately share in His glory. The Church therefore teaches that every human person deserves respect and protection because each person bears the image of their Creator.',

    catechism: {
      paragraphs: ['355', '356', '1700'],
      text: 'God created man in his own image. Of all visible creatures only man is able to know and love his creator. The dignity of the human person is rooted in his creation in the image and likeness of God.',
    },

    scripture: {
      reference: 'Genesis 1:26-27',
      text: 'Then God said, "Let us make man in our image, after our likeness." So God created man in his own image, in the image of God he created him.',
    },
  },
  {
    id: '4',

    slug: 'is-the-likeness-in-body-or-soul',

    category: 'God',

    question: 'Is this likeness to God in your body, or in your soul?',

    answer: 'This likeness to God is chiefly in my soul.',

    explanation:
      'God is pure spirit and does not possess a physical body. Therefore, the deepest way in which we resemble God is not through our physical appearance but through our spiritual nature. Human beings possess intellect and free will, allowing them to know truth, love goodness, and freely choose how they act. These spiritual powers reflect God in a unique way. While the human body is good and created by God, it is the soul that primarily bears His image and likeness. The soul enables us to enter into communion with God, receive His grace, and respond freely to His call. This truth reminds us that human dignity comes from more than outward appearance, strength, intelligence, or worldly success.',

    catechism: {
      paragraphs: ['363', '1703', '1711'],
      text: 'In Sacred Scripture the term soul often refers to human life or the entire human person. The human person, created in the image of God, is a being at once corporeal and spiritual. Endowed with a spiritual and immortal soul, the human person is ordered to God.',
    },

    scripture: {
      reference: 'Ecclesiastes 12:7',
      text: 'And the dust returns to the earth as it was, and the spirit returns to God who gave it.',
    },
  },
  {
    id: '5',

    slug: 'how-is-your-soul-like-to-god',

    category: 'God',

    question: 'How is your soul like to God?',

    answer: 'My soul is like to God because it is a spirit, and it is immortal.',

    explanation:
      'Unlike our bodies, which are material and subject to death, the soul is spiritual. Because it is a spirit, the soul is capable of knowing God, loving God, and entering into friendship with Him. The soul is also immortal, meaning that it does not cease to exist when the body dies. At death, the soul continues to live and awaits the final resurrection of the body. This truth gives immense dignity to every human person because each soul has an eternal destiny. Catholics believe that earthly life is not the end of our existence but the beginning of a journey that continues forever. The immortality of the soul reminds us that our choices matter, our relationship with God matters, and that we are created not merely for this life but for eternity. Through sanctifying grace, the soul is prepared to share forever in the life and happiness of God in Heaven.',

    catechism: {
      paragraphs: ['363', '366', '1703'],
      text: 'The human person, created in the image of God, is a being at once corporeal and spiritual. The Church teaches that every spiritual soul is created immediately by God and is immortal: it does not perish when it separates from the body at death.',
    },

    scripture: {
      reference: 'Matthew 10:28',
      text: 'And do not fear those who kill the body but cannot kill the soul; rather fear him who can destroy both soul and body in hell.',
    },
  },
  {
    id: '6',

    slug: 'what-does-it-mean-that-your-soul-is-immortal',

    category: 'God',

    question: 'What do you mean when you say that your soul is immortal?',

    answer: 'When I say my soul is immortal, I mean that my soul can never die.',

    explanation:
      'The soul is immortal because it is spiritual rather than material. While the body experiences death and returns to the earth, the soul continues to exist. Catholics believe that every person will live forever, either in perfect union with God or separated from Him by their own free choice. Death is therefore not the end of existence but the beginning of eternity. This truth gives great importance to the choices we make in this life. Because the soul survives death, our relationship with God matters far more than temporary earthly success or pleasure. The immortality of the soul also gives Christians hope when facing death, reminding them that God created human beings for eternal life. At the end of time, Christ will raise the dead and reunite each soul with a glorified body, completing Gods plan for His children.',

    catechism: {
      paragraphs: ['366', '988', '1016'],
      text: 'The Church teaches that every spiritual soul is immortal: it does not perish when it separates from the body at death. By death the soul is separated from the body, but in the resurrection God will give incorruptible life to our transformed body.',
    },

    scripture: {
      reference: 'Wisdom 3:1',
      text: 'But the souls of the righteous are in the hand of God, and no torment will ever touch them.',
    },
  },
  {
    id: '7',

    slug: 'why-must-you-take-care-of-your-soul',

    category: 'God',

    question: 'Of which must you take more care, of your body or of your soul?',

    answer:
      'I must take more care of my soul; for Christ has said, "What does it profit a man if he gains the whole world, and suffers the loss of his soul?"',

    explanation:
      'The body is a gift from God and should be respected and cared for, but the soul is even more important because it is immortal and destined for eternity. Many people spend enormous effort pursuing wealth, success, comfort, appearance, or popularity while neglecting their relationship with God. Jesus teaches that no earthly achievement can compensate for the loss of ones soul. Caring for the soul means praying regularly, receiving the sacraments, avoiding sin, growing in virtue, and seeking God in daily life. A healthy body is valuable, but even the healthiest body will eventually die. The soul, however, will live forever. Christians are therefore called to give first place to God and to the spiritual life, knowing that eternal realities are more important than temporary earthly concerns.',

    catechism: {
      paragraphs: ['1691', '1810', '2548'],
      text: 'Christian, recognize your dignity and now that you share in Gods own nature, do not return to your former base condition by sinning. The desire for true happiness frees man from attachment to the goods of this world.',
    },

    scripture: {
      reference: 'Matthew 16:26',
      text: 'For what will it profit a man if he gains the whole world and forfeits his life? Or what shall a man give in return for his life?',
    },
  },
  {
    id: '8',

    slug: 'what-must-you-do-to-save-your-soul',

    category: 'Salvation',

    question: 'What must you do to save your soul?',

    answer:
      'To save my soul I must worship God by Faith, Hope and Charity; that is, I must believe in him, I must hope in him, and I must love him with my whole heart.',

    explanation:
      'God desires the salvation of every person and provides the grace necessary for us to reach Heaven. The Christian life is built upon the three theological virtues of Faith, Hope, and Charity. Through Faith we believe what God has revealed. Through Hope we trust in Gods promises and seek eternal life. Through Charity we love God above all things and love our neighbour for His sake. These virtues are gifts from God that are strengthened through prayer, the sacraments, and faithful Christian living. Salvation is not simply about knowing facts about God but about entering into a living relationship with Him. As believers grow in Faith, Hope, and Charity, they become more fully united to Christ and better equipped to persevere in holiness throughout their lives.',

    catechism: {
      paragraphs: ['1812', '1813', '1822'],
      text: 'The human virtues are rooted in the theological virtues, which adapt mans faculties for participation in the divine nature. The theological virtues are faith, hope, and charity. Charity is the theological virtue by which we love God above all things for his own sake.',
    },

    scripture: {
      reference: '1 Corinthians 13:13',
      text: 'So faith, hope, love abide, these three; but the greatest of these is love.',
    },
  },
  {
    id: '9',

    slug: 'what-is-faith',

    category: 'Salvation',

    question: 'What is faith?',

    answer:
      'Faith is a supernatural gift of God, which enables us to believe without doubting whatever God has revealed.',

    explanation:
      'Faith is much more than a feeling or personal opinion. It is a gift from God that enables us to accept as true everything that He has revealed. Because God is perfectly truthful, Catholics trust His word even when some mysteries exceed human understanding. Faith does not oppose reason; rather, it perfects and elevates it. Through faith we come to know God, accept His promises, and place our trust in Jesus Christ. Faith is received as a gift but must be freely embraced and continually nourished. Prayer, Scripture, study, and participation in the sacraments help faith to grow stronger. Without faith it is impossible to please God fully because faith is the foundation upon which the entire Christian life is built.',

    catechism: {
      paragraphs: ['153', '154', '1814'],
      text: 'Faith is a supernatural virtue by which we believe in God and believe all that he has said and revealed to us, because he is truth itself. By faith man freely commits his entire self to God.',
    },

    scripture: {
      reference: 'Hebrews 11:1',
      text: 'Now faith is the assurance of things hoped for, the conviction of things not seen.',
    },
  },
  {
    id: '10',

    slug: 'why-must-you-believe-what-god-has-revealed',

    category: 'Salvation',

    question: 'Why must you believe whatever God has revealed?',

    answer:
      'I must believe whatever God has revealed because God is the very truth, and can neither deceive nor be deceived.',

    explanation:
      'Catholic faith rests ultimately on the trustworthiness of God Himself. Human beings can make mistakes, misunderstand facts, or even intentionally deceive others. God, however, is perfect truth. Because He knows all things perfectly and possesses absolute goodness, He can never lie or be mistaken. When God reveals something for our salvation, Christians can accept it with complete confidence. This certainty does not arise from our own intelligence but from Gods authority. Even when certain teachings are difficult to understand, believers trust the God who has revealed them. The act of faith is therefore an act of trust in Gods wisdom, goodness, and truthfulness. Believing what God has revealed draws us into a deeper relationship with Him and allows us to build our lives on a foundation that cannot fail.',

    catechism: {
      paragraphs: ['156', '157', '215'],
      text: 'What moves us to believe is not the fact that revealed truths appear as true and intelligible in the light of our natural reason, but the authority of God himself who reveals them, who can neither deceive nor be deceived. God is the fullness of Truth.',
    },

    scripture: {
      reference: 'Titus 1:2',
      text: 'In hope of eternal life which God, who never lies, promised ages ago.',
    },
  },

  {
    id: '11',

    slug: 'how-do-you-know-what-god-has-revealed',

    category: 'The Church',

    question: 'How are you to know what God has revealed?',

    answer:
      'I am to know what God has revealed by the testimony, teaching, and authority of the Catholic Church.',

    explanation:
      'God did not leave humanity to discover revealed truth on its own. Jesus established a visible Church and entrusted it with the responsibility of preserving and proclaiming His teachings. Before the New Testament was written, the apostles preached the Gospel and handed on what they had received from Christ. The Catholic Church continues this apostolic mission through Scripture, Sacred Tradition, and the teaching authority known as the Magisterium. Catholics therefore do not rely solely on private interpretation when seeking to understand divine revelation. Instead, they trust the Church that Christ founded and guided by the Holy Spirit. The Church faithfully safeguards the truths necessary for salvation and helps believers understand Gods revelation correctly. Through the Churches teaching, Christians can confidently know the faith that has been handed down from the apostles throughout the centuries.',

    catechism: {
      paragraphs: ['80', '85', '87'],
      text: 'Sacred Tradition and Sacred Scripture make up a single sacred deposit of the Word of God, entrusted to the Church. The task of giving an authentic interpretation of the Word of God has been entrusted to the living teaching office of the Church alone, whose authority is exercised in the name of Jesus Christ.',
    },

    scripture: {
      reference: '1 Timothy 3:15',
      text: 'The church of the living God is the pillar and bulwark of the truth.',
    },
  },
  {
    id: '12',

    slug: 'who-gave-the-church-authority-to-teach',

    category: 'The Church',

    question: 'Who gave the Catholic Church divine authority to teach?',

    answer:
      'Jesus Christ gave the Catholic Church divine authority to teach when he said, "Go therefore, make disciples of all the nations".',

    explanation:
      'The authority of the Catholic Church does not come from human wisdom, political power, or popular opinion. It comes from Jesus Christ Himself. Before ascending into Heaven, Christ commissioned the apostles to teach all nations, baptise believers, and hand on everything He had commanded. This mission did not end with the death of the apostles but continues through their successors, the bishops, united with the Pope. The Churchs teaching authority exists to preserve and faithfully explain the revelation entrusted to it by Christ. Catholics believe that when the Church officially teaches on matters of faith and morals, the Holy Spirit assists her so that the Gospel may be transmitted accurately from generation to generation. This divine mission gives Christians confidence that the Church remains a trustworthy guide in matters concerning salvation and the Christian life.',

    catechism: {
      paragraphs: ['888', '889', '2034'],
      text: 'Bishops, with priests as co-workers, have as their first task to preach the Gospel of God to all men. The Church, the pillar and bulwark of the truth, has received this solemn command of Christ from the apostles to announce the saving truth.',
    },

    scripture: {
      reference: 'Matthew 28:19-20',
      text: 'Go therefore and make disciples of all nations, baptising them in the name of the Father and of the Son and of the Holy Spirit, teaching them to observe all that I have commanded you; and behold, I am with you always, to the close of the age.',
    },
  },
  {
    id: '13',

    slug: 'what-are-the-chief-things-god-has-revealed',

    category: 'The Church',

    question: 'What are the chief things which God has revealed?',

    answer: "The chief things which God has revealed are contained in the Apostles' Creed.",

    explanation:
      "The Apostles' Creed is one of the oldest and most important summaries of the Christian faith. It contains the essential truths that God has revealed about Himself, creation, salvation, the Church, and eternal life. From the earliest centuries, Christians used the Creed to profess their faith, especially before Baptism. Although the Creed does not contain every Church teaching, it provides a concise summary of the core beliefs that all Catholics are called to accept. The Creed helps unite believers in a common profession of faith and serves as a foundation for further catechesis. By learning and praying the Creed, Catholics deepen their understanding of the truths revealed by God and handed down by the Church throughout the ages.",

    catechism: {
      paragraphs: ['186', '187', '197'],
      text: "From the beginning, the apostolic Church expressed and handed on her faith in brief formulae. Such syntheses are called professions of faith since they summarise the faith professed by Christians. The Apostles' Creed is the ancient baptismal symbol of the Church of Rome.",
    },

    scripture: {
      reference: '2 Timothy 1:13-14',
      text: 'Follow the pattern of the sound words which you have heard from me, in the faith and love which are in Christ Jesus; guard the truth that has been entrusted to you by the Holy Spirit who dwells within us.',
    },
  },
  {
    id: '14',

    slug: 'say-the-apostles-creed',

    category: 'The Church',

    question: "Say the Apostles' Creed.",

    answer:
      'I believe in God, the Father almighty, Creator of heaven and earth; and in Jesus Christ, his only Son, our Lord; who was conceived by the Holy Spirit, born of the Virgin Mary, suffered under Pontius Pilate, was crucified, died and was buried. He descended into hell; the third day he rose again from the dead; he ascended into heaven; and sits at the right hand of God the Father almighty; from thence he shall come to judge the living and the dead. I believe in the Holy Spirit; the holy Catholic Church; the communion of saints; the forgiveness of sins; the resurrection of the body; and life everlasting. Amen.',

    explanation:
      "The Apostles' Creed is one of the most important prayers and professions of faith in the Catholic Church. For nearly two thousand years, Christians have recited it to publicly proclaim what they believe about God, Jesus Christ, the Holy Spirit, the Church, and eternal life. The Creed provides a concise summary of the central truths of Christianity and serves as a foundation for Catholic teaching. It is recited during the Rosary and frequently used in the Church's liturgy. Learning the Creed helps Catholics understand not only what they believe but also why they believe it. Each statement within the Creed expresses an important truth revealed by God and handed down through the apostles. By praying the Creed thoughtfully, believers renew their commitment to the faith and unite themselves with Christians throughout the world and across history.",

    catechism: {
      paragraphs: ['185', '197', '199'],
      text: 'Whoever says "I believe" says "I pledge myself to what we believe." Communion in faith needs a common language of faith, normative for all and uniting all in the same confession of faith. The Apostles\' Creed is rightly considered to be a faithful summary of the apostles\' faith.',
    },

    scripture: {
      reference: 'Romans 10:9',
      text: 'Because, if you confess with your lips that Jesus is Lord and believe in your heart that God raised him from the dead, you will be saved.',
    },
  },
  {
    id: '15',

    slug: 'how-is-the-apostles-creed-divided',

    category: 'The Church',

    question: "How is the Apostles' Creed divided?",

    answer: "The Apostles' Creed is divided into twelve parts or articles.",

    explanation:
      "The Apostles' Creed is traditionally divided into twelve articles, each expressing an essential truth of the Christian faith. The articles begin with belief in God the Father as Creator, continue through the life, death, resurrection, and glorification of Jesus Christ, and conclude with the Holy Spirit, the Church, forgiveness of sins, resurrection of the body, and life everlasting. This structure helps Catholics understand the Creed as more than a prayer to be memorised. It is a summary of salvation history and a guide to the truths revealed by God. The division into articles also makes the Creed easier to study systematically, which is why many catechisms explain the faith article by article. By understanding each article, Catholics gain a deeper appreciation of the unity and beauty of the Christian faith.",

    catechism: {
      paragraphs: ['190', '191'],
      text: "The Creed is divided into three parts: the first speaks of the first divine Person and the wonderful work of creation; the next speaks of the second divine Person and the mystery of man's redemption; the third speaks of the Holy Spirit, the origin and source of our sanctification. These are further divided into twelve articles.",
    },

    scripture: {
      reference: 'Ephesians 4:5-6',
      text: 'One Lord, one faith, one baptism, one God and Father of us all, who is above all and through all and in all.',
    },
  },
  {
    id: '16',

    slug: 'what-is-the-first-article-of-the-creed',

    category: 'God',

    question: 'What is the first article of the Creed?',

    answer:
      'The first article of the Creed is, "I believe in God, the Father almighty, Creator of heaven and earth".',

    explanation:
      'The first article of the Apostles\' Creed forms the foundation of the entire Christian faith. Before speaking about Jesus Christ, the Church first professes belief in God the Father, who created everything that exists. By calling God "Father", Christians express the personal relationship that God desires with humanity. By calling Him "almighty", they acknowledge His unlimited power and authority over all creation. By professing Him as "Creator of heaven and earth", believers recognise that everything visible and invisible owes its existence to God. This article reminds us that the universe is not the result of chance but of God\'s wisdom and love. It also teaches that every human person depends upon God and finds their ultimate purpose in Him. All the other articles of the Creed build upon this fundamental truth about God and His relationship with creation.',

    catechism: {
      paragraphs: ['198', '199', '279'],
      text: 'Our profession of faith begins with God, for God is the First and the Last, the beginning and the end of everything. The Creed begins with God the Father, because the Father is the first divine Person of the Most Holy Trinity. We believe that God created the world according to his wisdom and love.',
    },

    scripture: {
      reference: 'Genesis 1:1',
      text: 'In the beginning God created the heavens and the earth.',
    },
  },
  {
    id: '17',

    slug: 'what-is-god',

    category: 'God',

    question: 'What is God?',

    answer:
      'God is the supreme spirit, who alone exists of himself, and is infinite in all perfection.',

    explanation:
      'God is not merely the greatest being within the universe. He is the Creator of all things and the source of all existence. Unlike every created thing, God depends on nothing and no one for His existence. He has always existed and always will exist. As a pure spirit, God does not have a physical body and is not limited by space or time. God possesses every perfection infinitely. His wisdom is perfect, His power is limitless, His justice is flawless, His mercy is boundless, and His love is beyond measure. Because God is infinite, human minds can never fully comprehend Him, yet He has revealed enough of Himself for us to know, love, and serve Him. Every good thing found in creation reflects something of Gods perfect goodness and points us back to Him as its source.',

    catechism: {
      paragraphs: ['202', '212', '213'],
      text: 'God revealed himself to his people Israel by making his name known to them. The divine name "I AM" expresses Gods faithfulness and eternity. God is fullness of Being and of every perfection, without origin and without end.',
    },

    scripture: {
      reference: 'John 4:24',
      text: 'God is spirit, and those who worship him must worship in spirit and truth.',
    },
  },
  {
    id: '18',

    slug: 'why-is-god-called-almighty',

    category: 'God',

    question: 'Why is God called almighty?',

    answer:
      'God is called almighty because he can do all things; "For God everything is possible".',

    explanation:
      'Gods almighty power means that nothing can prevent Him from accomplishing His holy will. He created the universe from nothing, sustains all creation in existence, and governs the world with wisdom and love. Gods power is not arbitrary or destructive. Rather, it is always exercised in harmony with His perfect goodness, wisdom, and justice. When Catholics profess that God is almighty, they are expressing complete confidence in His ability to fulfil His promises and accomplish His plan of salvation. Gods power is especially revealed in the Resurrection of Jesus Christ, through which He conquered sin and death. At the same time, Gods omnipotence does not mean that He acts contrary to His own nature. God cannot lie, sin, or cease to be God because such actions would contradict His perfect being. His almighty power is therefore the power of perfect truth, love, and goodness.',

    catechism: {
      paragraphs: ['268', '269', '276'],
      text: 'Of all the divine attributes, only Gods omnipotence is named in the Creed. God has universal power. He is almighty because he created everything, rules everything, and can do everything. Nothing is impossible with God.',
    },

    scripture: {
      reference: 'Matthew 19:26',
      text: 'But Jesus looked at them and said, "With men this is impossible, but with God all things are possible."',
    },
  },
  {
    id: '19',

    slug: 'why-is-god-called-creator-of-heaven-and-earth',

    category: 'God',

    question: 'Why is God called Creator of heaven and earth?',

    answer:
      'God is called "Creator of heaven and earth" because he made heaven and earth, and all things, out of nothing, by his word.',

    explanation:
      'Everything that exists owes its existence to God. Before creation, nothing existed except God Himself. By His infinite power and wisdom, God freely created the entire universe. He did not need pre-existing materials or assistance from anyone. The Church teaches that God created all things "out of nothing", a doctrine known as creation ex nihilo. This includes everything visible, such as the earth and the stars, as well as everything invisible, such as angels. Creation is not the result of chance, necessity, or blind forces, but of Gods loving will. Because God is the Creator, all creation reflects His wisdom and goodness and ultimately belongs to Him. Recognising God as Creator should inspire gratitude, wonder, humility, and responsible stewardship of the world He has entrusted to us.',

    catechism: {
      paragraphs: ['290', '295', '296'],
      text: 'In the beginning God created the heavens and the earth. We believe that God created the world according to his wisdom and love. God needs no pre-existent thing or any help in order to create, nor is creation any sort of necessary emanation from the divine substance. God creates freely out of nothing.',
    },

    scripture: {
      reference: 'Genesis 1:1',
      text: 'In the beginning God created the heavens and the earth.',
    },
  },
  {
    id: '20',

    slug: 'had-god-any-beginning',

    category: 'God',

    question: 'Had God any beginning?',

    answer: 'God had no beginning: he always was, he is, and always will be.',

    explanation:
      'Everything in the created world has a beginning. People are born, stars form, and even the universe itself had a beginning. God alone is different. He was not created and does not depend on anything else for His existence. God exists eternally, outside the limits of time. He does not grow older, change, or cease to exist. When God revealed Himself to Moses as "I AM", He revealed that He is the eternal and self-existent One. This truth gives Christians confidence because Gods promises do not change. Human beings come and go, but God remains forever the same. His love, faithfulness, truth, and power endure throughout all ages. The eternal nature of God reminds us that our lives are part of a much greater story and that our ultimate hope rests in the One who exists forever.',

    catechism: {
      paragraphs: ['212', '213', '220'],
      text: 'God is fullness of Being and of every perfection, without origin and without end. In revealing his mysterious name, "I AM WHO I AM", God says who he is and by what name he is to be called forever. God alone IS.',
    },

    scripture: {
      reference: 'Psalm 90:2',
      text: 'Before the mountains were brought forth, or ever you had formed the earth and the world, from everlasting to everlasting you are God.',
    },
  },
];
