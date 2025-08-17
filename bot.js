require('dotenv').config();
console.log('Discord Token:', process.env.DISCORD_TOKEN ? 'Found' : 'Missing');
console.log('OpenAI Key:', process.env.OPENAI_API_KEY ? 'Found' : 'Missing');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const OpenAI = require('openai');

// Configuration
const config = {
    token: process.env.DISCORD_TOKEN,
    openaiApiKey: process.env.OPENAI_API_KEY,
    prefix: '!ask',
    channels: process.env.ALLOWED_CHANNELS ? process.env.ALLOWED_CHANNELS.split(',') : []
};

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: config.openaiApiKey
});

// System prompt for the AI assistant
const systemPrompt = `You are an expert Amazon seller assistant that helps with FBA, FBM, product research, PPC, listing optimization, and all aspects of Amazon selling. You respond in both Haitian Creole and English based on the language of the question.

Key areas you help with:
- Product research and sourcing
- Listing optimization and SEO
- Amazon PPC and advertising
- FBA logistics and inventory management
- Account health and policy compliance
- Competitor analysis
- Profit calculations and pricing strategies
- Brand registry and intellectual property
- Customer service best practices
- Amazon tools and software recommendations

Language Guidelines:
- If the question is in Haitian Creole, respond primarily in Haitian Creole with English terms for technical Amazon concepts
- If the question is in English, respond in English
- Always be helpful, accurate, and provide actionable advice
- Include relevant Amazon terminology and current best practices
- Keep responses concise but comprehensive

Format your responses professionally and include specific steps when possible.`;

// Language detection helper
function detectLanguage(text) {
    const creoleWords = ['ki', 'ak', 'nan', 'pou', 'yo', 'mwen', 'nou', 'li', 'kòm', 'gen', 'fè', 'kisa', 'konnen'];
    const words = text.toLowerCase().split(' ');
    const creoleMatches = words.filter(word => creoleWords.includes(word));
    return creoleMatches.length > 2 ? 'creole' : 'english';
}

// Rate limiting
const userCooldowns = new Map();
const COOLDOWN_TIME = 30000; // 30 seconds

function isOnCooldown(userId) {
    if (!userCooldowns.has(userId)) return false;
    const lastUsed = userCooldowns.get(userId);
    return Date.now() - lastUsed < COOLDOWN_TIME;
}

function setCooldown(userId) {
    userCooldowns.set(userId, Date.now());
}

// Main message handler
client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if message starts with prefix or mentions the bot
    const isBotMention = message.mentions.has(client.user);
    const hasPrefix = message.content.toLowerCase().startsWith(config.prefix);
    
    if (!hasPrefix && !isBotMention) return;

    // Check channel permissions (if configured)
    if (config.channels.length > 0 && !config.channels.includes(message.channel.id)) {
        return message.reply('❌ This bot can only be used in designated channels.');
    }

    // Extract question
    let question = '';
    if (hasPrefix) {
        question = message.content.slice(config.prefix.length).trim();
    } else if (isBotMention) {
        question = message.content.replace(`<@${client.user.id}>`, '').trim();
    }

    if (!question) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#FF9900')
            .setTitle('🛒 Amazon Seller Assistant / Asistan Vantè Amazon')
            .setDescription(`
**English Usage:**
\`${config.prefix} [your question]\` or mention me with your question

**Kreyòl Ayisyen:**
\`${config.prefix} [kesyon ou]\` oswa mansyone mwen ak kesyon ou

**Examples / Egzanp:**
• ${config.prefix} How do I optimize my product listing?
• ${config.prefix} Kijan mwen ka jwenn bon pwodwi pou vann?
• @bot What's the best PPC strategy for new products?
            `)
            .setFooter({ text: 'Amazon Seller Helper Bot' });

        return message.reply({ embeds: [helpEmbed] });
    }

    // Rate limiting
    if (isOnCooldown(message.author.id)) {
        const timeLeft = Math.ceil((COOLDOWN_TIME - (Date.now() - userCooldowns.get(message.author.id))) / 1000);
        return message.reply(`⏱️ Please wait ${timeLeft} seconds before asking another question. / Tanpri tann ${timeLeft} segonn anvan ou poze yon lòt kesyon.`);
    }

    // Show typing indicator
    await message.channel.sendTyping();

    try {
        setCooldown(message.author.id);

        // Detect language for better context
        const detectedLang = detectLanguage(question);
        
        // Enhanced system prompt based on detected language
        const enhancedPrompt = `${systemPrompt}

Current question language detected: ${detectedLang}
User question: "${question}"

Please provide a helpful, accurate response about Amazon selling. If this is about a topic outside Amazon selling, politely redirect to Amazon-related topics.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: enhancedPrompt },
                { role: "user", content: question }
            ],
            max_tokens: 1000,
            temperature: 0.7
        });

        const response = completion.choices[0].message.content;

        // Split long responses into multiple messages if needed
        if (response.length > 2000) {
            const chunks = response.match(/.{1,1900}/g) || [response];
            for (let i = 0; i < chunks.length; i++) {
                const embed = new EmbedBuilder()
                    .setColor('#FF9900')
                    .setTitle(i === 0 ? '🛒 Amazon Seller Assistant' : `🛒 Amazon Seller Assistant (Part ${i + 1})`)
                    .setDescription(chunks[i])
                    .setFooter({ 
                        text: chunks.length > 1 ? `Part ${i + 1} of ${chunks.length}` : 'Amazon Seller Helper Bot' 
                    });

                if (i === 0) {
                    await message.reply({ embeds: [embed] });
                } else {
                    await message.channel.send({ embeds: [embed] });
                }
            }
        } else {
            const embed = new EmbedBuilder()
                .setColor('#FF9900')
                .setTitle('🛒 Amazon Seller Assistant')
                .setDescription(response)
                .setFooter({ text: 'Amazon Seller Helper Bot' });

            await message.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error('Error processing message:', error);
        
        let errorMessage = '❌ Sorry, I encountered an error processing your request.';
        
        if (error.code === 'insufficient_quota') {
            errorMessage = '❌ API quota exceeded. Please contact the bot administrator.';
        } else if (error.code === 'invalid_api_key') {
            errorMessage = '❌ API configuration error. Please contact the bot administrator.';
        }

        errorMessage += '\n❌ Padon, mwen gen yon pwoblèm ak demand ou an.';

        await message.reply(errorMessage);
    }
});

// Bot ready event
client.on('ready', () => {
    console.log(`✅ ${client.user.tag} is online and ready to help Amazon sellers!`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
    
    // Set bot status
    client.user.setActivity('Amazon Seller Questions | !ask', { type: 'LISTENING' });
});

// Error handling
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Login
if (!config.token) {
    console.error('❌ DISCORD_TOKEN environment variable is required');
    process.exit(1);
}

if (!config.openaiApiKey) {
    console.error('❌ OPENAI_API_KEY environment variable is required');
    process.exit(1);
}

client.login(config.token);