"use strict";

// ======================================
// CHATWAVE: SUPABASE-POWERED VERSION
// ======================================

const $ = (id) => document.getElementById(id);

const sb = window.supabase.createClient(
    window.CHATWAVE_CONFIG.url,
    window.CHATWAVE_CONFIG.key
);

const authScreen = $("authScreen");
const authForm = $("authForm");
const authMessage = $("authMessage");
const app = $("app");
const contactsBox = $("contacts");
const messagesBox = $("messages");
const messageForm = $("messageForm");
const messageInput = $("messageInput");
const searchInput = $("contactSearch");
const emojiPicker = $("emojiPicker");

const emojis = [
    "😀", "😂", "😍", "🥰", "😎", "😭",
    "😊", "😉", "❤️", "🔥", "👍", "👋",
    "🎉", "🙏", "💯", "🤔", "😴", "✨"
];

// ---- state ----
let me = null;                 // auth user
let myProfile = null;          // row from public.profiles
let contacts = [];             // other people's profiles
let currentContact = null;     // profile id of open chat
let currentConversationId = null;
let messages = [];             // messages of the open chat
let conversationByContact = new Map(); // contactId -> conversationId
let contactByConversation = new Map(); // conversationId -> contactId
let unread = new Set();        // contact ids with unseen messages
let onlineIds = new Set();
let pinned = [];
let isRegistering = false;
let startedFor = null;

let feedChannel = null;
let presenceChannel = null;
let typingChannel = null;
let typingTimer;
let remoteTypingTimer;
let audioContext;

const imageUrlCache = new Map();

// ======================================
// SMALL HELPERS
// ======================================

function readStore(key, fallback) {
    try {
        const saved = localStorage.getItem(key);
        return saved === null ? fallback : JSON.parse(saved);
    } catch {
        return fallback;
    }
}

function saveStore(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // storage unavailable, ignore
    }
}

function nameOf(profile) {
    return profile.display_name || profile.username.split("@")[0];
}

function initialOf(profile) {
    return nameOf(profile).charAt(0).toUpperCase();
}

function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

function toMessage(row) {
    return {
        id: row.id,
        text: row.content || "",
        imagePath: row.image_path || "",
        sender: row.sender_id === me.id ? "sent" : "received",
        time: formatTime(row.created_at)
    };
}

async function getImageUrl(path) {
    if (imageUrlCache.has(path)) return imageUrlCache.get(path);

    const { data, error } = await sb.storage
        .from("chat-images")
        .createSignedUrl(path, 3600);

    if (error) return "";

    imageUrlCache.set(path, data.signedUrl);
    return data.signedUrl;
}

// ======================================
// AUTH
// ======================================

$("loginTab").addEventListener("click", () => setAuthMode(false));
$("registerTab").addEventListener("click", () => setAuthMode(true));

function setAuthMode(register) {
    isRegistering = register;

    $("loginTab").classList.toggle("active", !register);
    $("registerTab").classList.toggle("active", register);

    $("nameLabel").hidden = !register;
    $("authName").hidden = !register;
    $("authName").required = register;

    $("authSubmit").textContent = register ? "Create account" : "Login";
    authMessage.textContent = "";
}

authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = $("authEmail").value.trim().toLowerCase();
    const password = $("authPassword").value;
    const name = $("authName").value.trim();

    if (!email || !password) return;

    $("authSubmit").disabled = true;
    authMessage.textContent = "Please wait...";

    try {
        if (isRegistering) {
            if (!name) {
                authMessage.textContent = "Please enter your name.";
                return;
            }

            const { data, error } = await sb.auth.signUp({
                email,
                password,
                options: { data: { name } }
            });

            if (error) {
                authMessage.textContent = error.message;
                return;
            }

            if (!data.session) {
                authMessage.textContent =
                    "Account created! Check your email to confirm it, then log in.";
                setAuthMode(false);
                return;
            }
            // With a session, onAuthStateChange starts the app.
        } else {
            const { error } = await sb.auth.signInWithPassword({
                email,
                password
            });

            if (error) {
                authMessage.textContent = error.message;
                return;
            }
        }

        authMessage.textContent = "";
    } finally {
        $("authSubmit").disabled = false;
    }
});

$("logoutButton").addEventListener("click", async () => {
    await sb.auth.signOut();
});

sb.auth.onAuthStateChange((event, session) => {
    if (session?.user) {
        if (startedFor !== session.user.id) {
            // Defer: avoid awaiting Supabase calls inside this callback.
            setTimeout(() => startApp(session.user), 0);
        }
    } else {
        resetApp();
    }
});

function resetApp() {
    startedFor = null;
    me = null;
    myProfile = null;
    contacts = [];
    currentContact = null;
    currentConversationId = null;
    messages = [];
    conversationByContact.clear();
    contactByConversation.clear();
    unread.clear();
    onlineIds.clear();

    [feedChannel, presenceChannel, typingChannel].forEach((ch) => {
        if (ch) sb.removeChannel(ch);
    });
    feedChannel = presenceChannel = typingChannel = null;

    app.hidden = true;
    app.classList.remove("chat-open");
    authScreen.hidden = false;
    $("authPassword").value = "";
    $("authName").value = "";
    contactsBox.replaceChildren();
    messagesBox.replaceChildren();
    setAuthMode(false);
}

// ======================================
// START APP AND PROFILE
// ======================================

async function startApp(user) {
    startedFor = user.id;
    me = user;
    pinned = readStore(`chatwave_pinned_${me.id}`, []);

    const { data: profile, error } = await sb
        .from("profiles")
        .select("*")
        .eq("id", me.id)
        .single();

    if (error || !profile) {
        authMessage.textContent = "Could not load your profile. Try again.";
        await sb.auth.signOut();
        return;
    }

    myProfile = profile;

    authScreen.hidden = true;
    app.hidden = false;
    renderMyProfile();

    await Promise.all([loadContacts(), loadConversations()]);

    displayContacts();
    subscribeToFeed();
    subscribeToPresence();

    if (contacts.length) {
        selectContact(contacts[0].id, { openOnMobile: false });
    } else {
        showNoContacts();
    }
}

function renderMyProfile() {
    const name = nameOf(myProfile);
    $("myName").textContent = name;
    $("myAvatar").textContent = initialOf(myProfile);

    $("profileName").value = name;
    $("profileAbout").value = myProfile.about || "";
    $("profileAvatar").textContent = initialOf(myProfile);
}

$("profileButton").addEventListener("click", () => {
    $("profilePanel").hidden = false;
});

$("closeProfile").addEventListener("click", () => {
    $("profilePanel").hidden = true;
});

$("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = $("profileName").value.trim();
    const about = $("profileAbout").value.trim();

    if (!name) return;

    const { data, error } = await sb
        .from("profiles")
        .update({ display_name: name, about })
        .eq("id", me.id)
        .select()
        .single();

    if (error) {
        alert("Could not save profile: " + error.message);
        return;
    }

    myProfile = data;
    renderMyProfile();
    $("profilePanel").hidden = true;
});

// ======================================
// LOADING CONTACTS AND CONVERSATIONS
// ======================================

async function loadContacts() {
    const { data, error } = await sb
        .from("profiles")
        .select("id, username, display_name, about")
        .neq("id", me.id)
        .order("display_name", { ascending: true });

    contacts = error ? [] : data;
}

async function loadConversations() {
    const { data } = await sb
        .from("conversations")
        .select("id, user_one, user_two");

    conversationByContact.clear();
    contactByConversation.clear();

    (data || []).forEach((conv) => {
        const other = conv.user_one === me.id ? conv.user_two : conv.user_one;
        conversationByContact.set(other, conv.id);
        contactByConversation.set(conv.id, other);
    });
}

async function ensureConversation(contactId) {
    if (conversationByContact.has(contactId)) {
        return conversationByContact.get(contactId);
    }

    let result = await sb
        .from("conversations")
        .insert({ user_one: me.id, user_two: contactId })
        .select("id")
        .single();

    // Unique pair index: if it already exists, look it up instead.
    if (result.error) {
        await loadConversations();
        if (conversationByContact.has(contactId)) {
            return conversationByContact.get(contactId);
        }
        throw result.error;
    }

    conversationByContact.set(contactId, result.data.id);
    contactByConversation.set(result.data.id, contactId);
    return result.data.id;
}

// ======================================
// CONTACTS LIST AND PINNING
// ======================================

function showNoContacts() {
    messagesBox.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.style.textAlign = "center";
    empty.textContent =
        "No one else has registered yet. Create a second account to start chatting!";
    messagesBox.append(empty);
    $("chatName").textContent = "No contacts yet";
    $("chatAvatar").textContent = "?";
    $("chatStatus").textContent = "";
}

function displayContacts() {
    const search = searchInput.value.trim().toLowerCase();

    const list = contacts
        .filter((c) => nameOf(c).toLowerCase().includes(search))
        .sort((a, b) => {
            const pinDifference =
                Number(pinned.includes(b.id)) - Number(pinned.includes(a.id));
            return pinDifference || nameOf(a).localeCompare(nameOf(b));
        });

    contactsBox.replaceChildren();

    list.forEach((contact) => {
        const row = document.createElement("div");
        row.className = "contact";
        row.classList.toggle("active", contact.id === currentContact);

        const avatar = document.createElement("div");
        avatar.className = "avatar";
        avatar.textContent = initialOf(contact);

        const text = document.createElement("div");
        text.className = "contact-text";

        const name = document.createElement("strong");
        name.textContent = nameOf(contact);

        const preview = document.createElement("small");
        preview.textContent = contact.about || "Hey there! I'm using ChatWave.";

        text.append(name, preview);
        row.append(avatar, text);

        if (onlineIds.has(contact.id)) {
            const dot = document.createElement("span");
            dot.className = "online-dot";
            dot.title = "Online";
            row.append(dot);
        }

        if (unread.has(contact.id)) {
            const badge = document.createElement("span");
            badge.className = "pin-label";
            badge.textContent = "🔵";
            badge.title = "New message";
            row.append(badge);
        }

        if (pinned.includes(contact.id)) {
            const pin = document.createElement("span");
            pin.className = "pin-label";
            pin.textContent = "📌";
            row.append(pin);
        }

        row.addEventListener("click", () => selectContact(contact.id));
        contactsBox.append(row);
    });
}

searchInput.addEventListener("input", displayContacts);

async function selectContact(id, { openOnMobile = true } = {}) {
    const contact = contacts.find((c) => c.id === id);
    if (!contact) return;

    currentContact = id;
    currentConversationId = null;
    messages = [];
    unread.delete(id);

    $("chatName").textContent = nameOf(contact);
    $("chatAvatar").textContent = initialOf(contact);
    updateContactStatus();
    updatePinButton();

    if (openOnMobile) app.classList.add("chat-open");
    $("typingIndicator").hidden = true;
    emojiPicker.hidden = true;

    displayContacts();
    displayMessages();

    try {
        const conversationId = await ensureConversation(id);
        if (currentContact !== id) return; // user switched meanwhile

        currentConversationId = conversationId;

        const { data, error } = await sb
            .from("messages")
            .select("*")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: true });

        if (currentContact !== id) return;
        if (error) throw error;

        messages = data.map(toMessage);
        displayMessages();
        subscribeToTyping(conversationId);
    } catch (err) {
        console.error(err);
        alert("Could not open this conversation: " + (err.message || err));
    }
}

$("backButton").addEventListener("click", () => {
    app.classList.remove("chat-open");
});

$("pinButton").addEventListener("click", () => {
    if (!currentContact) return;

    if (pinned.includes(currentContact)) {
        pinned = pinned.filter((id) => id !== currentContact);
    } else {
        pinned.push(currentContact);
    }

    saveStore(`chatwave_pinned_${me.id}`, pinned);
    updatePinButton();
    displayContacts();
});

function updatePinButton() {
    const isPinned = pinned.includes(currentContact);
    $("pinButton").textContent = isPinned ? "📌 Unpin" : "📌 Pin";
    $("pinButton").title = isPinned
        ? "Unpin conversation"
        : "Pin conversation";
}

function updateContactStatus() {
    if (!currentContact) return;
    $("chatStatus").textContent = onlineIds.has(currentContact)
        ? "Online"
        : "Offline";
}

// ======================================
// DISPLAY MESSAGES
// ======================================

function displayMessages() {
    messagesBox.replaceChildren();

    if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No messages yet. Say hello! 👋";
        empty.style.textAlign = "center";
        messagesBox.append(empty);
        return;
    }

    messages.forEach((message) => {
        const bubble = document.createElement("div");
        bubble.className = `message ${message.sender}`;

        if (message.imagePath) {
            const img = document.createElement("img");
            img.alt = "Shared image";
            bubble.append(img);

            getImageUrl(message.imagePath).then((url) => {
                if (url) img.src = url;
            });
        }

        if (message.text) {
            const text = document.createElement("div");
            text.textContent = message.text;
            bubble.append(text);
        }

        const meta = document.createElement("div");
        meta.className = "message-meta";

        const time = document.createElement("span");
        time.textContent = message.time;
        meta.append(time);

        if (message.sender === "sent") {
            const receipt = document.createElement("span");
            receipt.textContent = "✓ Sent";
            meta.append(receipt);

            const deleteButton = document.createElement("button");
            deleteButton.className = "delete-message";
            deleteButton.type = "button";
            deleteButton.textContent = "🗑️";
            deleteButton.title = "Delete message";
            deleteButton.setAttribute("aria-label", "Delete message");
            deleteButton.addEventListener("click", () =>
                deleteMessage(message.id)
            );
            meta.append(deleteButton);
        }

        bubble.append(meta);
        messagesBox.append(bubble);
    });

    messagesBox.scrollTop = messagesBox.scrollHeight;
}

async function deleteMessage(id) {
    const { error } = await sb.from("messages").delete().eq("id", id);

    if (error) {
        alert("Could not delete message: " + error.message);
        return;
    }

    messages = messages.filter((m) => m.id !== id);
    displayMessages();
}

$("clearButton").addEventListener("click", async () => {
    if (!currentConversationId) return;

    if (!confirm("Delete all of YOUR messages in this conversation? " +
        "(The other person's messages stay.)")) return;

    const { error } = await sb
        .from("messages")
        .delete()
        .eq("conversation_id", currentConversationId)
        .eq("sender_id", me.id);

    if (error) {
        alert("Could not clear conversation: " + error.message);
        return;
    }

    messages = messages.filter((m) => m.sender !== "sent");
    displayMessages();
});

// ======================================
// SEND MESSAGES
// ======================================

messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = messageInput.value.trim();
    if (!text || !currentConversationId) return;

    messageInput.value = "";

    const { data, error } = await sb
        .from("messages")
        .insert({
            conversation_id: currentConversationId,
            sender_id: me.id,
            content: text
        })
        .select()
        .single();

    if (error) {
        messageInput.value = text;
        alert("Could not send message: " + error.message);
        return;
    }

    addIncomingRow(data);
    playNotification();
});

function addIncomingRow(row) {
    if (row.conversation_id !== currentConversationId) return;
    if (messages.some((m) => m.id === row.id)) return; // dedupe

    messages.push(toMessage(row));
    displayMessages();
}

// ======================================
// REALTIME: MESSAGES, PRESENCE, TYPING
// ======================================

function subscribeToFeed() {
    feedChannel = sb
        .channel("messages-feed")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "messages" },
            async (payload) => {
                const row = payload.new;
                if (row.sender_id === me.id) return; // already added locally

                if (!contactByConversation.has(row.conversation_id)) {
                    await loadConversations(); // someone started a new chat with me
                }

                if (row.conversation_id === currentConversationId) {
                    addIncomingRow(row);
                    playNotification();
                } else {
                    const contactId = contactByConversation.get(row.conversation_id);
                    if (contactId) {
                        unread.add(contactId);
                        displayContacts();
                        playNotification();
                    }
                }
            }
        )
        .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "messages" },
            (payload) => {
                const id = payload.old?.id;
                if (id && messages.some((m) => m.id === id)) {
                    messages = messages.filter((m) => m.id !== id);
                    displayMessages();
                }
            }
        )
        .subscribe();
}

function subscribeToPresence() {
    presenceChannel = sb.channel("online-users", {
        config: { presence: { key: me.id } }
    });

    presenceChannel
        .on("presence", { event: "sync" }, () => {
            onlineIds = new Set(Object.keys(presenceChannel.presenceState()));
            displayContacts();
            updateContactStatus();
        })
        .subscribe(async (status) => {
            if (status === "SUBSCRIBED") {
                await presenceChannel.track({ at: Date.now() });
            }
        });
}

function subscribeToTyping(conversationId) {
    if (typingChannel) sb.removeChannel(typingChannel);

    typingChannel = sb
        .channel(`typing:${conversationId}`, {
            config: { broadcast: { self: false } }
        })
        .on("broadcast", { event: "typing" }, () => {
            const contact = contacts.find((c) => c.id === currentContact);
            if (!contact) return;

            $("typingIndicator").textContent = `${nameOf(contact)} is typing...`;
            $("typingIndicator").hidden = false;

            clearTimeout(remoteTypingTimer);
            remoteTypingTimer = setTimeout(() => {
                $("typingIndicator").hidden = true;
            }, 1800);
        })
        .subscribe();
}

let lastTypingSent = 0;

messageInput.addEventListener("input", () => {
    if (!typingChannel) return;

    const now = Date.now();
    if (now - lastTypingSent < 1000) return;
    lastTypingSent = now;

    typingChannel.send({
        type: "broadcast",
        event: "typing",
        payload: { from: me.id }
    });
});

// ======================================
// EMOJI PICKER
// ======================================

emojis.forEach((emoji) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = emoji;
    button.setAttribute("aria-label", `Insert ${emoji}`);

    button.addEventListener("click", () => {
        messageInput.value += emoji;
        messageInput.focus();
        emojiPicker.hidden = true;
    });

    emojiPicker.append(button);
});

$("emojiButton").addEventListener("click", () => {
    emojiPicker.hidden = !emojiPicker.hidden;
});

document.addEventListener("click", (event) => {
    if (
        !emojiPicker.contains(event.target) &&
        event.target !== $("emojiButton")
    ) {
        emojiPicker.hidden = true;
    }
});

// ======================================
// IMAGE MESSAGES (Supabase Storage)
// ======================================

$("imageInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";

    if (!file || !currentConversationId) return;

    if (!file.type.startsWith("image/")) {
        alert("Please choose an image file.");
        return;
    }

    if (file.size > 1024 * 1024) {
        alert("Please choose an image smaller than 1 MB.");
        return;
    }

    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${currentConversationId}/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await sb.storage
        .from("chat-images")
        .upload(path, file, { contentType: file.type });

    if (uploadError) {
        alert("Could not upload image: " + uploadError.message);
        return;
    }

    const { data, error } = await sb
        .from("messages")
        .insert({
            conversation_id: currentConversationId,
            sender_id: me.id,
            content: "",
            image_path: path
        })
        .select()
        .single();

    if (error) {
        alert("Could not send image: " + error.message);
        return;
    }

    addIncomingRow(data);
    playNotification();
});

// ======================================
// NOTIFICATION SOUND
// ======================================

function playNotification() {
    try {
        const AudioContextClass =
            window.AudioContext || window.webkitAudioContext;

        if (!AudioContextClass) return;

        audioContext ||= new AudioContextClass();

        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();

        oscillator.connect(gain);
        gain.connect(audioContext.destination);

        oscillator.type = "sine";
        oscillator.frequency.value = 740;
        gain.gain.value = 0.06;

        oscillator.start();

        gain.gain.exponentialRampToValueAtTime(
            0.001,
            audioContext.currentTime + 0.15
        );

        oscillator.stop(audioContext.currentTime + 0.15);
    } catch {
        // Sound may be unavailable in some browsers.
    }
}

// ======================================
// DARK MODE
// ======================================

function setDarkMode(enabled) {
    document.body.classList.toggle("dark", enabled);
    $("themeButton").textContent = enabled ? "☀️" : "🌙";
    saveStore("chatwave_dark", enabled);
}

$("themeButton").addEventListener("click", () => {
    setDarkMode(!document.body.classList.contains("dark"));
});

setDarkMode(readStore("chatwave_dark", false));

// ======================================
// INITIALISE
// ======================================

setAuthMode(false);
// If a saved session exists, onAuthStateChange fires and starts the app.
