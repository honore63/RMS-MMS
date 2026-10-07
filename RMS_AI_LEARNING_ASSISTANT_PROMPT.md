# RMS AI LEARNING ASSISTANT

Integrate an **AI Learning Assistant** directly into the public RMS Digital Library.

The AI should help learners understand and ask questions about the educational resources uploaded to the **Rukara Model School Digital Library**.

## 1. AI CHAT INTERFACE

Add a prominent **“Ask RMS AI”** button/card on the Digital Library homepage.

Students can ask questions such as:

> “Explain photosynthesis from this document.”
> “Give me five questions about this topic.”
> “Explain this lesson in simple language.”
> “What is the difference between these two concepts?”
> “Summarize this PDF.”
> “Create revision questions from this chapter.”

The interface should look like a modern educational AI chat assistant.

---

## 2. AI MUST USE LIBRARY CONTENT

The AI should prioritize information from the **uploaded RMS Digital Library resources**.

Do not make it behave like a completely unrestricted chatbot.

When a student selects a resource, the AI should answer questions based primarily on that resource.

Example:

**Resource:** P6 Mathematics – Fractions Notes

**Student:**

> How do I add fractions with different denominators?

**RMS AI:**

> Based on the selected P6 Mathematics resource, you first find a common denominator...

The AI should identify the resource used for the answer.

---

## 3. “ASK ABOUT THIS RESOURCE”

Every resource card should have:

**View | Download | Ask AI**

When the student clicks **Ask AI**, open the AI assistant with that resource automatically selected.

Display:

> **You are asking RMS AI about:**
> P6 Mathematics – Fractions Notes

This creates a direct connection between the resource and the AI.

---

## 4. MULTIPLE RESOURCE QUESTIONS

Allow students to select multiple resources.

Example:

**Selected resources:**

* P6 Mathematics Notes
* P6 Mathematics Lesson Plan
* P6 Mathematics Revision Paper

Then the student can ask:

> “Using these materials, prepare 10 revision questions for me.”

The AI should use only the selected resources where possible.

---

## 5. AI LEARNING FEATURES

Provide quick actions:

### Explain
Explain the selected content in simple language.

### Summarize
Create a short summary.

### Quiz Me
Generate questions from the content.

### Practice
Generate exercises for the learner.

### Key Points
Extract important concepts.

### Ask a Question
Allow free-form questions.

### Simplify
Explain difficult concepts in learner-friendly language.

### Revision
Create a revision guide from the resource.

---

## 6. EDUCATION-LEVEL AWARENESS

The AI should understand the learner's selected:

* Education level
* Class
* Subject
* Topic

For example:

**P6 + Mathematics**

should produce explanations appropriate for P6 learners.

Avoid unnecessarily advanced university-level explanations.

---

## 7. SOURCE REFERENCES

Every AI answer based on library content should show its source.

Example:

> **Source:** P6 Mathematics – Fractions Notes
> **Section:** Adding Fractions

Where possible, allow the student to click **“View Source”** and return to the relevant library resource.

This is important for trust and academic accuracy.

---

## 8. HANDLING QUESTIONS OUTSIDE THE RESOURCE

If the answer cannot be found in the selected resource, the AI should clearly say:

> “I could not find this information in the selected Rukara Model School resource.”

Then optionally offer:

> **Search other approved RMS resources**

Do not confidently invent information and present it as if it came from the school's materials.

---

## 9. AI SAFETY AND EDUCATIONAL USE

The AI should act as a **learning assistant, not a replacement for the teacher**.

It should:

* Encourage understanding
* Explain concepts
* Provide examples
* Generate practice questions
* Give hints
* Encourage learners to think

For homework/examination questions, prefer guiding the learner through the solution rather than simply giving answers when appropriate.

Do not expose:

* Teacher private documents
* Draft lesson plans
* DOS-only resources
* Private assessments
* Private student information
* Supabase credentials
* Internal database information

Only use resources that the current user is authorized to access.

---

# 10. AI ARCHITECTURE

Because the RMS backend uses Supabase, do not expose an AI API key in frontend JavaScript.

Never put an OpenAI/AI provider secret key inside:

```text
frontend/js/*.js
```

Use a secure server-side mechanism such as a **Supabase Edge Function**.

Recommended architecture:

```text
Student
   ↓
RMS Digital Library
   ↓
Ask RMS AI
   ↓
Supabase Edge Function
   ↓
Retrieve relevant approved library content
   ↓
AI Model
   ↓
Educational answer + source reference
   ↓
Student
```

---

# 11. CONTENT SEARCH / RAG

Implement a **Retrieval-Augmented Generation (RAG)** architecture.

When a resource is uploaded:

```text
File
 ↓
Extract text/content
 ↓
Split into manageable chunks
 ↓
Create embeddings
 ↓
Store searchable chunks
 ↓
Store resource relationship
```

When the student asks a question:

```text
Student Question
 ↓
Create question embedding
 ↓
Search relevant resource chunks
 ↓
Retrieve approved content
 ↓
Send context to AI
 ↓
Generate answer
 ↓
Return answer + source
```

Use Supabase/PostgreSQL with **pgvector**. Keep indexed text private to the backend and expose retrieval only through server-side functions that verify current resource visibility and AI eligibility.

---

# 12. SUPPORTED AI CONTENT

The AI should work with the formats for which a safe text-extraction workflow is deployed:

* PDF
* TXT
* JPEG, PNG, and WebP images containing readable educational text

Use OCR or a vision-capable extraction workflow for supported images. Do not advertise unsupported file formats as indexed content.

Office files, video, and audio remain browseable/downloadable but are not AI-indexed until their extractors/transcription workflows are implemented and tested.

---

# 13. STUDENT AI EXPERIENCE

Create a clean interface:

```text
┌──────────────────────────────────────────────┐
│             🤖 ASK RMS AI                    │
│                                              │
│  Ask questions about your learning resources │
│                                              │
│  📚 Selected Resource                        │
│  P6 Mathematics – Fractions                  │
│                                              │
│  ──────────────────────────────────────────  │
│                                              │
│  Student: How do I add unlike fractions?     │
│                                              │
│  RMS AI:                                     │
│  First find a common denominator...          │
│                                              │
│  Source: P6 Mathematics – Fractions Notes    │
│                                              │
│  [ Ask a question...                    ]    │
│                              [Send]          │
└──────────────────────────────────────────────┘
```

Make it responsive for phones, tablets, and computers.

---

# 14. TEACHER BENEFIT

Teachers should also have access to the AI where permitted.

Teachers could use uploaded resources to:

* Generate revision questions
* Generate quizzes
* Generate discussion questions
* Summarize resources
* Create differentiated activities
* Generate learner practice exercises

However, teacher-only/private resources must never become publicly accessible through the AI.

---

# 15. DOS CONTROL

Add AI-related controls to the DOS dashboard:

* Enable/disable AI assistant
* View AI usage statistics
* Manage AI-accessible resources
* Exclude specific resources from AI indexing
* Review reported AI responses
* Monitor frequently asked topics

Possible statistics:

```text
AI Questions Today
AI Questions This Month
Most Asked Subject
Most Asked Class
Most Used Resources
```

---

# 16. IMPORTANT SECURITY RULE

The AI retrieval system must respect the **same RLS and visibility rules as the Digital Library**.

Never allow an AI query to bypass database permissions.

For example:

```text
PUBLIC STUDENT
     ↓
ONLY PUBLISHED PUBLIC RESOURCES

TEACHER
     ↓
PUBLIC + AUTHORIZED TEACHER RESOURCES

DOS
     ↓
RESOURCES WITHIN DOS EDUCATION-LEVEL SCOPE
```

The AI must never retrieve a document merely because it exists in Supabase Storage.

It must verify that the current user is authorized to access the resource before using its content.

---

# 17. FINAL USER-FACING NAME

Use:

### 🤖 RMS AI LEARNING ASSISTANT

Subtitle:

**“Ask. Learn. Understand.”**

Alternative:

**“Learn from your school's digital resources with AI.”**

Integrate the AI naturally into:

`frontend/digital-library.html`

without creating a completely separate website.

The final RMS Digital Library should therefore provide:

**UPLOAD → ORGANIZE → SEARCH → READ → WATCH → DOWNLOAD → ASK AI → LEARN**
