# My Gmail Agent – AI-Powered Chrome Browser Extension

## 📌 Overview

**My Gmail Agent** is an AI-powered Chrome extension that integrates directly with Gmail to assist users in managing emails more efficiently. Powered by **Google Gemini 2.5 Flash**, it provides intelligent features without requiring users to leave the Gmail interface.

This project was developed as a final-year undergraduate project to improve email productivity and reduce inbox overload.

---

## 🔮 User Interface Modules

#### 💬 Thread Tools

Operate on an individual open email conversation:

* Generate Reply
* Summarize Thread

#### 🗂️ Inbox Tools

Operate on the Gmail inbox view:

* Smart Search
* Analyze Priority

---

## ✨ Features Implemented

| Feature              | UI Action                                                         | Description                                                                                                                                                | API Endpoint          |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Generate Reply**   | Draft reply is injected directly into Gmail's compose box         | Generates a context-aware draft reply based on the open email thread.                                                                                      | `POST /api/reply`     |
| **Summarize Thread** | Summary is displayed in a pop-up panel                            | Creates a concise summary of the entire email conversation, highlighting key discussion points, decisions, and action items.                               | `POST /api/summarize` |
| **Smart Search**     | Gmail search is automatically triggered using the generated query | Performs semantic email search by converting natural-language queries into context-aware Gmail search queries. | `GET /api/search`     |
| **Analyze Priority** | Results are displayed as a list view                  | Analyzes multiple inbox emails, and extracts key action items with individual deadlines.                                         | `POST /api/priority`  |

---

## 🛠️ Technology Stack

### Frontend

* JavaScript
* Chrome Manifest v3
* Chrome Runtime Messaging

### Backend

* Java 17+
* Spring Boot
* Spring AI

### AI

* Google Gemini 2.5 Flash

---

## 🎓 Developed By

* Swarnotaj Kundu 
* Sonu Singh Patar 

---

## 📄 License

This project was developed for academic and educational purposes as part of an undergraduate final-year project.
