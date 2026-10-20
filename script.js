"use strict";

// ======================================
// CHATWAVE: DEMO APPLICATION
// ======================================

const $ = (id) => document.getElementById(id);

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

const defaultContacts = [
    { id: 1, name: "Amy", avatar: "A", status: "Online" },
    { id: 2, name: "Daniel", avatar: "D", status: "Online" },
    { id: 3, name: "Sarah", avatar: "S", status: "Offline" },
    { id: 4, name: "Michael", avatar: "M", status: "Online" },
    { id: 5, name: "Jessica", avatar: "J", status: "Offline" }
];

const demoReplies = [
    "That's cool! 😄",
    "Awesome! 👍",
    "Sounds good!",
    "I agree!",
    "Haha 😂",
    "Tell me more!"
];

const emojis = [
    "😀", "😂", "😍", "🥰", "😎", "😭",
    "😊", "😉", "❤️", "🔥", "👍", "👋",
    "🎉", "🙏", "💯", "🤔", "😴", "✨"
];

let contacts = [...defaultContacts];
let currentContact = 1;
let currentUser = null;
let isRegistering = false;
let allMessages = readStore("chatwave_messages", {});
let profiles = readStore("chatwave_profiles", {});
let pinned = readStore("chatwave_pinned", []);
let typingTimer;
let replyTimers = [];
let audioContext;

// ======================================
// LOCAL STORAGE HELPERS
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
        return true;
    } catch {
        alert("Storage is full or unavailable. Try a smaller image.");
        return false;
    }
}

function saveMessages() {
    saveStore("chatwave_messages", allMessages);
}

function getMessages(id = currentContact) {
    return allMessages[id] || [];
}

function getProfile(email) {
    return profiles[email] || {
        name: email.split("@")[0],
        about: "Hey there! I'm using ChatWave."
    };
}

// ======================================
// DEMO LOGIN AND REGISTRATION
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

authForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const email = $("authEmail").value.trim().toLowerCase();
    const password = $("authPassword").value;

    if (!email || !password) return;

    if (isRegistering) {
        if (password.length < 4) {
            authMessage.textContent = "Use at least 4 characters for this demo.";
            return;
        }

        if (profiles[email]) {
            authMessage.textContent = "That demo account already exists. Please log in.";
            return;
        }

        // Demo only: never store real passwords this way.
        profiles[email] = {
            name: $("authName").value.trim(),
            about: "Hey there! I'm using ChatWave.",
            demoPassword: password
        };

        if (!profiles[email].name) {
            authMessage.textContent = "Please enter your name.";
            delete profiles[email];
            return;
        }

        if (!saveStore("chatwave_profiles", profiles)) {
            delete profiles[email];
            return;
        }
    } else {
        const account = profiles[email];

        if (!account || account.demoPassword !== password) {
            authMessage.textContent =
                "Account not found or password incorrect. Register a demo account first.";
            return;
        }
    }

    currentUser = email;
    sessionStorage.setItem("chatwave_session", email);
    startApp();
});

function logout() {
    currentUser = null;
    sessionStorage.removeItem("chatwave_session");
    app.hidden = true;
    authScreen.hidden = false;
    $("authPassword").value = "";
    $("authName").value = "";
    authMessage.textContent = "";
    setAuthMode(false);
}

$("logoutButton").addEventListener("click", logout);

// ======================================
// START APP AND PROFILE
// ======================================

function startApp() {
    if (!currentUser || !profiles[currentUser]) return;

    authScreen.hidden = true;
    app.hidden = false;

    const profile = getProfile(currentUser);
    $("myName").textContent = profile.name;
    $("myAvatar").textContent = profile.name.charAt(0).toUpperCase();

    $("profileName").value = profile.name;
    $("profileAbout").value = profile.about;
    $("profileAvatar").textContent = profile.name.charAt(0).toUpperCase();

    displayContacts();
    selectContact(currentContact);
}

$("profileButton").addEventListener("click", () => {
    $("profilePanel").hidden = false;
});

$("closeProfile").addEventListener("click", () => {
    $("profilePanel").hidden = true;
});

$("profileForm").addEventListener("submit", (event) => {
    event.preventDefault();

    const name = $("profileName").value.trim();
    const about = $("profileAbout").value.trim();

    if (!name) return;

    profiles[currentUser].name = name;
    profiles[currentUser].about = about;

    if (!saveStore("chatwave_profiles", profiles)) return;

    $("myName").textContent = name;
    $("myAvatar").textContent = name.charAt(0).toUpperCase();
    $("profileAvatar").textContent = name.charAt(0).toUpperCase();
    $("profilePanel").hidden = true;
});

// ======================================
// CONTACTS AND PINNED CONVERSATIONS
// ======================================

function displayContacts() {
    const search = searchInput.value.trim().toLowerCase();

    const list = contacts
        .filter(contact => contact.name.toLowerCase().includes(search))
        .sort((a, b) => {
            const pinDifference =
                Number(pinned.includes(b.id)) -
                Number(pinned.includes(a.id));

            return pinDifference || a.id - b.id;
        });

    contactsBox.replaceChildren();

    list.forEach(contact => {
        const row = document.createElement("div");
        row.className = "contact";
        row.classList.toggle("active", contact.id === currentContact);

        const avatar = document.createElement("div");
        avatar.className = "avatar";
        avatar.textContent = contact.avatar;

        const text = document.createElement("div");
        text.className = "contact-text";

        const name = document.createElement("strong");
        name.textContent = contact.name;

        const preview = document.createElement("small");
        const lastMessage = getMessages(contact.id).at(-1);
        preview.textContent = lastMessage
            ? (lastMessage.image ? "📷 Photo" : lastMessage.text)
            : contact.status;

        text.append(name, preview);
        row.append(avatar, text);

        if (contact.status === "Online") {
            const dot = document.createElement("span");
            dot.className = "online-dot";
            dot.title = "Online";
            row.append(dot);
        }

        if (pinned.includes(contact.id)) {
            const pin = document.createElement("span");
            pin.className = "pin-label";
            pin.textContent = "📌";
            row.append(pin);
        }

        row.addEventListener("click", () => {
            selectContact(contact.id);
        });

        contactsBox.append(row);
    });
}

searchInput.addEventListener("input", displayContacts);

function selectContact(id) {
    currentContact = id;

    const contact = contacts.find(item => item.id === id);
    if (!contact) return;

    $("chatName").textContent = contact.name;
    $("chatAvatar").textContent = contact.avatar;

    updateContactStatus();
    $("app").classList.add("chat-open");
    $("typingIndicator").hidden = true;
    emojiPicker.hidden = true;

    displayContacts();
    displayMessages();
}

$("backButton").addEventListener("click", () => {
    app.classList.remove("chat-open");
});

$("pinButton").addEventListener("click", () => {
    if (pinned.includes(currentContact)) {
        pinned = pinned.filter(id => id !== currentContact);
    } else {
        pinned.push(currentContact);
    }

    saveStore("chatwave_pinned", pinned);
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
    const contact = contacts.find(item => item.id === currentContact);
    if (!contact) return;

    $("chatStatus").textContent = contact.status === "Online"
        ? "Online"
        : "Last seen recently";
}

function updateContactPreview() {
    displayContacts();
}

// ======================================
// DISPLAY MESSAGES AND READ RECEIPTS
// ======================================

function displayMessages() {
    messagesBox.replaceChildren();

    const messages = getMessages();

    if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No messages yet. Say hello! 👋";
        empty.style.textAlign = "center";
        messagesBox.append(empty);
        updateContactPreview();
        return;
    }

    messages.forEach(message => {
        const bubble = document.createElement("div");
        bubble.className = `message ${message.sender}`;

        if (message.image) {
            const img = document.createElement("img");
            img.src = message.image;
            img.alt = "Shared image";
            bubble.append(img);
        }

        if (message.text) {
            const text = document.createElement("div");
            text.textContent = message.text;
            bubble.append(text);
        }

        const meta = document.createElement("div");
        meta.className = "message-meta";

        const time = document.createElement("span");
        time.textContent = message.time || "";

        meta.append(time);

        if (message.sender === "sent") {
            const receipt = document.createElement("span");
            receipt.textContent = message.status === "seen"
                ? "✓✓ Seen"
                : message.status === "delivered"
                    ? "✓✓ Delivered"
                    : "✓ Sent";

            meta.append(receipt);
        }

        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-message";
        deleteButton.type = "button";
        deleteButton.textContent = "🗑️";
        deleteButton.title = "Delete message";
        deleteButton.setAttribute("aria-label", "Delete message");

        deleteButton.addEventListener("click", () => {
            deleteMessage(message.id);
        });

        meta.append(deleteButton);
        bubble.append(meta);
        messagesBox.append(bubble);
    });

    messagesBox.scrollTop = messagesBox.scrollHeight;
    updateContactPreview();
}

function addMessage({ text = "", image = "", sender = "sent" }) {
    if (!allMessages[currentContact]) {
        allMessages[currentContact] = [];
    }

    const message = {
        id: crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + Math.random(),
        text,
        image,
        sender,
        time: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        }),
        status: sender === "sent" ? "sent" : ""
    };

    allMessages[currentContact].push(message);
    saveMessages();
    displayMessages();

    return message;
}

function deleteMessage(id) {
    allMessages[currentContact] = getMessages().filter(
        message => message.id !== id
    );

    saveMessages();
    displayMessages();
}

$("clearButton").addEventListener("click", () => {
    if (!confirm("Delete every message in this conversation?")) return;

    allMessages[currentContact] = [];
    saveMessages();
    displayMessages();
});

// ======================================
// SEND TEXT MESSAGES
// ======================================

messageForm.addEventListener("submit", event => {
    event.preventDefault();

    const text = messageInput.value.trim();
    if (!text) return;

    addMessage({ text, sender: "sent" });

    messageInput.value = "";
    playNotification();

    // Simulated delivery and seen statuses.
    const conversationId = currentContact;
    const sentMessage = getMessages().at(-1);

    setTimeout(() => {
        if (sentMessage) {
            sentMessage.status = "delivered";
            saveMessages();

            if (currentContact === conversationId) {
                displayMessages();
            }
        }
    }, 400);

    setTimeout(() => {
        if (sentMessage) {
            sentMessage.status = "seen";
            saveMessages();

            if (currentContact === conversationId) {
                displayMessages();
            }
        }
    }, 1100);

    sendFakeReply(conversationId);
});

// ======================================
// TYPING INDICATOR AND SIMULATED REPLIES
// ======================================

messageInput.addEventListener("input", () => {
    $("typingIndicator").hidden = false;
    $("typingIndicator").textContent = "You are typing...";

    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
        $("typingIndicator").hidden = true;
    }, 800);
});

function sendFakeReply(conversationId) {
    const contact = contacts.find(item => item.id === conversationId);

    if (!contact || contact.status !== "Online") return;

    if (conversationId === currentContact) {
        $("typingIndicator").textContent = `${contact.name} is typing...`;
        $("typingIndicator").hidden = false;
    }

    const timer = setTimeout(() => {
        if (conversationId === currentContact) {
            $("typingIndicator").hidden = true;
        }

        const reply = demoReplies[
            Math.floor(Math.random() * demoReplies.length)
        ];

        allMessages[conversationId] ||= [];

        allMessages[conversationId].push({
            id: crypto.randomUUID
                ? crypto.randomUUID()
                : String(Date.now()) + Math.random(),
            text: reply,
            image: "",
            sender: "received",
            time: new Date().toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit"
            }),
            status: ""
        });

        saveMessages();

        if (currentContact === conversationId) {
            displayMessages();
            playNotification();
        } else {
            displayContacts();
        }
    }, 1600);

    replyTimers.push(timer);
}

// ======================================
// EMOJI PICKER
// ======================================

emojis.forEach(emoji => {
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

document.addEventListener("click", event => {
    if (
        !emojiPicker.contains(event.target) &&
        event.target !== $("emojiButton")
    ) {
        emojiPicker.hidden = true;
    }
});

// ======================================
// IMAGE MESSAGES
// ======================================

$("imageInput").addEventListener("change", event => {
    const file = event.target.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        alert("Please choose an image file.");
        event.target.value = "";
        return;
    }

    if (file.size > 700 * 1024) {
        alert("Please choose an image smaller than 700 KB for this demo.");
        event.target.value = "";
        return;
    }

    const reader = new FileReader();

    reader.onload = () => {
        addMessage({
            image: reader.result,
            sender: "sent"
        });

        playNotification();
        sendFakeReply(currentContact);
    };

    reader.onerror = () => {
        alert("Could not read that image.");
    };

    reader.readAsDataURL(file);
    event.target.value = "";
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

const savedSession = sessionStorage.getItem("chatwave_session");

if (savedSession && profiles[savedSession]) {
    currentUser = savedSession;
    startApp();
}