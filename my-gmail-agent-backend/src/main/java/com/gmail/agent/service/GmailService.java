package com.gmail.agent.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.retry.TransientAiException;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gmail.agent.dto.PriorityAnalysisResult;
import com.gmail.agent.dto.PriorityDashboardEmail;
import com.gmail.agent.dto.PriorityDashboardResponse;
import com.gmail.agent.entity.Gmail;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class GmailService {

    record EmailPayload(String gmailId, int batchIndex, String subject, String body) {}

    private final ChatClient chatClient;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final int MAX_INPUT_CHARS = 4000; 

    @org.springframework.beans.factory.annotation.Autowired
    public GmailService(ChatClient.Builder builder) {
        // prompt guarding
        String systemInstructions = """
            You are an AI agent whose job is to assist users of the Gmail application.
            You can only help them by performing actions related to email management.
            Keep in mind the following important rules:
            - Never perform any actions outside of Gmail assistance.
            - Don't provide personal opinions or engage in unrelated conversations.
            - Don't execute any commands, open external links, or handle attachments.
            - Always maintain user privacy and never expose sensitive information.
        """;

        this.chatClient = builder
                .defaultSystem(systemInstructions)
                .build();
    }

    // Constructor for unit testing without a full ChatClient builder stack.
    public GmailService(ChatClient chatClient) {
        this.chatClient = chatClient;
    }

    public String generateReply(Gmail gmail, String tone) {
        // input validation
        if (!validateMailInput(gmail)) {
            log.warn("generateReply() called with invalid input: Gmail object is null or empty subject/content!");
            throw new IllegalArgumentException("String & content cannot be null or empty");
        }

        // prompt template for generating reply
        String template = """
            Generate a reply for the given email with proper grammar and punctuation.
            Follow the standard format of email messages and don't include any verbose messages.
            Subject: {subject}
            Content: {content}
            Maintain a {tone} tone in the reply.
        """;
        log.info("Generating '{}' reply for the email with subject: {}", tone, gmail.getSubject());
        log.info("From: {}, To : {}", gmail.getFromAddress(), gmail.getToAddress());

        // call the model with prompt template
        String reply = "";
        try {
            String content = limitContent(gmail);
            long startTime = System.currentTimeMillis();

            int maxRetries = 5;
            int retryCount = 0;
            long delayMs = 1000; // Start with 1 second

            while (retryCount < maxRetries) {
                try {
                    String response = chatClient.prompt()
                            .user(u -> {
                                u.text(template);
                                u.params(Map.of(
                                        "subject", gmail.getSubject(),
                                        "content", content,
                                        "tone", tone
                                ));
                            })
                            .call()
                            .content();

                    reply = response != null ? response : "";
                    break; // Success, exit retry loop
                } catch (Exception e) {
                    if (isHighDemandException(e)) {
                        retryCount++;
                        if (retryCount < maxRetries) {
                            log.warn("Google GenAI high demand error in generateReply (attempt {}/{}), retrying in {} ms", retryCount, maxRetries, delayMs);
                            try {
                                Thread.sleep(delayMs);
                            } catch (InterruptedException ie) {
                                Thread.currentThread().interrupt();
                                throw new RuntimeException("Interrupted while retrying", ie);
                            }
                            delayMs *= 2; // Exponential backoff
                            continue;
                        }
                        throw new TransientAiException("Google GenAI service is temporarily unavailable due to high demand. Please retry later.", e);
                    }
                    // If not a high-demand error or max retries reached, rethrow
                    throw e;
                }
            }

            long duration = System.currentTimeMillis() - startTime;

            log.info("Reply generated successfully!");
            log.info("Reply length: {} chars, Time taken: {} ms", reply.length(), duration);
        } catch (Exception e) {
            log.warn("Error in generating reply! Message: {}", e.getMessage());
            throw e;
        }
        return reply;
    }

    private String limitContent(Gmail gmail) {
        String content = gmail.getContent();
        if (content.length() <= MAX_INPUT_CHARS) {
            return content;
        }

        List<String> chunkSummaries = new ArrayList<>();

        for (int start = 0; start < content.length(); start += MAX_INPUT_CHARS) {
            int end = Math.min(start + MAX_INPUT_CHARS, content.length());
            Gmail chunk = new Gmail();
            chunk.setSubject(gmail.getSubject());
            chunk.setContent(content.substring(start, end));

            String summary = generateSummary(chunk, "BULLET POINTS");
            chunkSummaries.add(summary);
        }

        Gmail merged = new Gmail();
        merged.setSubject(gmail.getSubject());
        merged.setContent(String.join("\n\n", chunkSummaries));

        return generateSummary(merged, "SHORT");
    }

    public String generateSummary(Gmail gmail, String style) {
        if (!validateMailInput(gmail)) {
            log.warn("generateSummary() called with invalid input: Gmail object is null or empty subject/content!");
            throw new IllegalArgumentException("Subject & content cannot be null or empty");
        }

        String template = """
        Summarize the following email content clearly and concisely. Don't include any verbose messages.
        Provide a {style} style summary that captures the key points without extra details.
        Subject: {subject}
        Content: {content}
        Style can be one of the following:
        - SHORT: Write a 1–2 sentence summary (maximum 40 words) that captures only the primary purpose or intent of the email.
        - BULLET POINTS: Provide a concise bullet-point list highlighting key actions, deadlines, requests, and decisions.
        - DETAILED: Write a well-structured paragraph (maximum 100 words) that includes context, important details, and any next steps.
        """;

        log.info("Generating '{}' style summary for the email with subject: {}", style, gmail.getSubject());

        // enforce input size cap
        String rawContent = gmail.getContent();
        String contentToUse;
        if (rawContent.length() > MAX_INPUT_CHARS) {
            log.warn("Content too long for generateSummary ({} chars); truncating to {}", rawContent.length(), MAX_INPUT_CHARS);
            contentToUse = rawContent.substring(0, MAX_INPUT_CHARS);
        } else {
            contentToUse = rawContent;
        }

        String summary = "";
        try {
            long startTime = System.currentTimeMillis();

            int maxRetries = 5;
            int retryCount = 0;
            long delayMs = 1000; // Start with 1 second

            while (retryCount < maxRetries) {
                try {
                    String response = chatClient.prompt()
                            .user(u -> {
                                u.text(template);
                                u.params(Map.of(
                                        "subject", gmail.getSubject(),
                                        "content", contentToUse,
                                        "style", style
                                ));
                            })
                            .call()
                            .content();

                    summary = response != null ? response : "";
                    break; // Success, exit retry loop
                } catch (Exception e) {
                    if (isHighDemandException(e)) {
                        retryCount++;
                        if (retryCount < maxRetries) {
                            log.warn("Google GenAI high demand error in generateSummary (attempt {}/{}), retrying in {} ms", retryCount, maxRetries, delayMs);
                            try {
                                Thread.sleep(delayMs);
                            } catch (InterruptedException ie) {
                                Thread.currentThread().interrupt();
                                throw new RuntimeException("Interrupted while retrying", ie);
                            }
                            delayMs *= 2; // Exponential backoff
                            continue;
                        }
                        throw new TransientAiException("Google GenAI service is temporarily unavailable due to high demand. Please retry later.", e);
                    }
                    // If not a high-demand error or max retries reached, rethrow
                    throw e;
                }
            }

            long duration = System.currentTimeMillis() - startTime;

            log.info("Summary generated successfully!");
            log.info("Summary length: {} chars, Time taken: {} ms", summary.length(), duration);
        } catch (Exception e) {
            log.warn("Error in generating summary! Message: {}", e.getMessage());
            throw e;
        }

        return summary;
    }

    private boolean validateMailInput(Gmail gmail) {
        return gmail != null && gmail.getSubject() != null && !gmail.getSubject().isEmpty()
                && gmail.getContent() != null && !gmail.getContent().isEmpty();
    }

    private boolean isHighDemandException(Throwable e) {
        Throwable cause = e;
        while (cause != null) {
            String message = cause.getMessage();
            if (message != null) {
                String lower = message.toLowerCase();
                if (lower.contains("high demand") || lower.contains("503") || lower.contains("service unavailable")) {
                    return true;
                }
            }
            cause = cause.getCause();
        }
        return false;
    }

    public String smartSearch(String userQuery) {
        // Prompt template to generate standard Gmail search query from natural language of user query
        String template = """
            Convert the user query in natural language into a valid Gmail search query.
            Output ONLY the search query. NO verbose texts.
            Use the following keywords for Gmail search with proper syntax as appropriate.
            
            Address filters- from:, to:, cc:, bcc:
            Content filters- subject:, AROUND, AND, OR
            Date filters- after:, before:, older:, newer:, older_than:, newer_than:
            Location filters- in:inbox, in:sent, in:spam, in:trash etc.
            Category filters- category:primary, category:social, category:promotions etc.
            Label filters- label:
            Attachment filters- filename:pdf, filename:xlsx, has:attachment, has:youtube etc.
            Status filters- is:unread, is:starred, is:important
            Size filters- size:, larger:, smaller:
            Mailing lists- list:
            
            Use only those operators that match the user intent. Remove duplicates. Quote names if needed.
            Normalize the dates given that the current timestamp is: {currentTime}
            User query: {userQuery}
        """;

        String standardQuery = "";
        try {
            long startTime = System.currentTimeMillis();

            int maxRetries = 5;
            int retryCount = 0;
            long delayMs = 1000; // Start with 1 second

            while (retryCount < maxRetries) {
                try {
                    String response = chatClient.prompt()
                            .user(u -> {
                                u.text(template);
                                u.params(Map.of(
                                        "userQuery", userQuery,
                                        "currentTime", LocalDateTime.now()
                                ));
                            })
                            .call()
                            .content();

                    standardQuery = response != null ? response : "";
                    break; // Success, exit retry loop
                } catch (Exception e) {
                    if (isHighDemandException(e)) {
                        retryCount++;
                        if (retryCount < maxRetries) {
                            log.warn("Google GenAI high demand error in smartSearch (attempt {}/{}), retrying in {} ms", retryCount, maxRetries, delayMs);
                            try {
                                Thread.sleep(delayMs);
                            } catch (InterruptedException ie) {
                                Thread.currentThread().interrupt();
                                throw new RuntimeException("Interrupted while retrying", ie);
                            }
                            delayMs *= 2; // Exponential backoff
                            continue;
                        }
                        throw new TransientAiException("Google GenAI service is temporarily unavailable due to high demand. Please retry later.", e);
                    }
                    // If not a high-demand error or max retries reached, rethrow
                    throw e;
                }
            }

            long duration = System.currentTimeMillis() - startTime;

            log.info("User Query : {}", userQuery);
            log.info("Standard Query : {}", standardQuery);
            log.info("Search query generated successfully!");
            log.info("Query length: {} chars, Time taken: {} ms", standardQuery.length(), duration);
        } catch (Exception e) {
            log.warn("Error in generating search query! Message: {}", e.getMessage());
            throw e;
        }
        return standardQuery;
    }

    public PriorityAnalysisResult analyzePriority(Gmail gmail) {

        // 1. Basic Validation
        if (gmail == null || gmail.getSubject() == null || gmail.getSubject().isBlank()) {
            throw new IllegalArgumentException("Email subject cannot be empty");
        }

        // 2. Body Handling
        String body = gmail.getContent();
        if (body == null || body.isBlank()) {
            body = "No content provided.";
        } else if (body.length() > MAX_INPUT_CHARS) {
            body = body.substring(0, MAX_INPUT_CHARS);
        }

        final String bodyForPrompt = body;

        // 3. Prompt
        String template = """
        You are an intelligent Email Productivity Assistant.

        Analyze the email and extract:

        1. Whether action is required
        2. What is the action item
        3. The deadline (normalized to DD/MM/YYYY format or NULL)
        4. The reason (only for NO_ACTION_REQUIRED)

        Rules:
        - Important → ACTION_REQUIRED
        - Promotional → NO_ACTION_REQUIRED
        - Keep actionItem short

        DEADLINE NORMALIZATION:
        - Use reference timestamp: """ + LocalDateTime.now() + """
        - Convert all detected dates to DD/MM/YYYY format
        - Handle relative dates: "within 3 days", "tomorrow", "end of this week", etc.
        - If no deadline is found, return NULL
        - Examples:
          * "tomorrow" → calculate from reference timestamp
          * "within 3 days" → calculate from reference timestamp
          * "end of this week" → calculate from reference timestamp
          * "15th March 2024" → "15/03/2024"
          * "March 15, 2024" → "15/03/2024"

        IMPORTANT:
        - Return ONLY valid JSON
        - Do NOT wrap JSON in quotes
        - No explanation text
        - If actionDecision is "ACTION_REQUIRED", set reason to empty string ""
        - If actionDecision is "NO_ACTION_REQUIRED", provide a short reason

        Format:
        {
        "actionDecision": "ACTION_REQUIRED or NO_ACTION_REQUIRED",
        "actionItem": "short phrase or NONE",
        "deadline": "DD/MM/YYYY or NULL",
        "reason": "empty string for ACTION_REQUIRED, short explanation for NO_ACTION_REQUIRED"
        }
        """
        + "\nEmail Subject: " + gmail.getSubject()
        + "\nEmail Body: " + bodyForPrompt;

        try {
            int maxRetries = 5;
            int retryCount = 0;
            long delayMs = 1000; // Start with 1 second

            while (retryCount < maxRetries) {
                try {
                    String response = chatClient.prompt()
                            .user(template)
                            .call()
                            .content();

                    log.info("RAW AI RESPONSE: {}", response);

                    return parsePriorityResponse(response);
                } catch (Exception e) {
                    if (isHighDemandException(e)) {
                        retryCount++;
                        if (retryCount < maxRetries) {
                            log.warn("Google GenAI high demand error (attempt {}/{}), retrying in {} ms", retryCount, maxRetries, delayMs);
                            try {
                                Thread.sleep(delayMs);
                            } catch (InterruptedException ie) {
                                Thread.currentThread().interrupt();
                                throw new RuntimeException("Interrupted while retrying", ie);
                            }
                            delayMs *= 2; // Exponential backoff
                            continue;
                        }
                        throw new TransientAiException("Google GenAI service is temporarily unavailable due to high demand. Please retry later.", e);
                    }
                    // If not a high-demand error or max retries reached, rethrow
                    throw e;
                }
            }
            // This should not be reached, but just in case
            throw new RuntimeException("Max retries exceeded for Google GenAI API");

        } catch (Exception e) {
            log.error("Error in priority analysis: {}", e.getMessage());
            throw e;
        }
    }

    public PriorityAnalysisResult parsePriorityResponse(String response) {
        if (response == null || response.isBlank()) {
            return new PriorityAnalysisResult("UNKNOWN", List.of(), List.of(), null, "", null, "Empty AI response");
        }

        String cleaned = extractJson(response)
                .replace("\\\"", "\"")
                .replace("\\n", "")
                .replace("\\r", "")
                .replace("\\t", "")
                .trim();

        try {
            if (cleaned.startsWith("\"") && cleaned.endsWith("\"")) {
                cleaned = objectMapper.readValue(cleaned, String.class);
            }

            try {
                PriorityAnalysisResult parsed = objectMapper.readValue(cleaned, PriorityAnalysisResult.class);
                return normalizePriorityAnalysisResult(parsed);
            } catch (JsonProcessingException e) {
                JsonNode root = objectMapper.readTree(cleaned);
                String actionDecision = root.path("actionDecision").asText("UNKNOWN");

                List<String> actionItems = new ArrayList<>();
                String singleActionItem = root.path("actionItem").asText("").trim();
                if (root.has("actionItems") && root.get("actionItems").isArray()) {
                    for (JsonNode item : root.get("actionItems")) {
                        if (item.isTextual()) {
                            String t = item.asText().trim();
                            if (!t.isEmpty() && !t.equalsIgnoreCase("NONE") && !t.equalsIgnoreCase("NULL")) {
                                actionItems.add(t);
                            }
                        }
                    }
                }
                if (!singleActionItem.isEmpty() && actionItems.isEmpty()) {
                    actionItems.add(singleActionItem);
                }

                List<PriorityAnalysisResult.DeadlineEntry> deadlines = new ArrayList<>();
                String singleDeadline = root.path("deadline").asText("").trim();
                if (root.has("deadlines") && root.get("deadlines").isArray()) {
                    for (JsonNode entry : root.get("deadlines")) {
                        String date = entry.path("date").asText("").trim();
                        String context = entry.path("context").asText("").trim();
                        if (!date.isEmpty() && !date.equalsIgnoreCase("NULL") && !date.equalsIgnoreCase("NONE")) {
                            deadlines.add(new PriorityAnalysisResult.DeadlineEntry(date, context));
                        }
                    }
                }
                if (!singleDeadline.isEmpty() && deadlines.isEmpty()) {
                    deadlines.add(new PriorityAnalysisResult.DeadlineEntry(singleDeadline, "Deadline"));
                }

                String primaryDeadline = null;
                if (root.hasNonNull("primaryDeadline")) {
                    String pd = root.path("primaryDeadline").asText("").trim();
                    if (!pd.isEmpty() && !pd.equalsIgnoreCase("NULL") && !pd.equalsIgnoreCase("NONE")) {
                        primaryDeadline = pd;
                    }
                }
                if (primaryDeadline == null && !deadlines.isEmpty()) {
                    primaryDeadline = deadlines.get(0).date();
                }

                String reason = root.path("reason").asText("");
                PriorityAnalysisResult result = new PriorityAnalysisResult(actionDecision, actionItems, deadlines, primaryDeadline, singleActionItem, (!singleDeadline.isEmpty() ? singleDeadline : null), reason);
                return normalizePriorityAnalysisResult(result);
            }
        } catch (Exception e) {
            log.error("FINAL PARSE FAILED: {}", cleaned, e);
            return new PriorityAnalysisResult("UNKNOWN", List.of(), List.of(), null, "", null, cleaned);
        }
    }

    private PriorityAnalysisResult normalizePriorityAnalysisResult(PriorityAnalysisResult result) {
        String actionDecision = result.actionDecision() != null ? result.actionDecision() : "UNKNOWN";

        List<String> actionItems = new ArrayList<>();
        if (result.actionItems() != null) {
            for (String item : result.actionItems()) {
                if (item != null) {
                    String trimmed = item.trim();
                    if (!trimmed.isEmpty() && !trimmed.equalsIgnoreCase("NONE") && !trimmed.equalsIgnoreCase("NULL")) {
                        actionItems.add(trimmed);
                    }
                }
            }
        }
        if (actionItems.isEmpty() && result.actionItem() != null) {
            String single = result.actionItem().trim();
            if (!single.isEmpty() && !single.equalsIgnoreCase("NONE") && !single.equalsIgnoreCase("NULL")) {
                actionItems = List.of(single);
            }
        }

        String actionItem = result.actionItem();
        if (actionItem != null) {
            actionItem = actionItem.trim();
            if (actionItem.isEmpty() || actionItem.equalsIgnoreCase("NONE") || actionItem.equalsIgnoreCase("NULL")) {
                actionItem = null;
            }
        }
        if ((actionItem == null || actionItem.isBlank()) && !actionItems.isEmpty()) {
            actionItem = actionItems.get(0);
        }

        List<PriorityAnalysisResult.DeadlineEntry> deadlines = new ArrayList<>();
        if (result.deadlines() != null) {
            for (PriorityAnalysisResult.DeadlineEntry entry : result.deadlines()) {
                if (entry != null) {
                    String date = entry.date() != null ? entry.date().trim() : "";
                    String context = entry.context() != null ? entry.context().trim() : "";
                    if (!date.isEmpty() && !date.equalsIgnoreCase("NONE") && !date.equalsIgnoreCase("NULL")) {
                        deadlines.add(new PriorityAnalysisResult.DeadlineEntry(date, context));
                    }
                }
            }
        }
        if (deadlines.isEmpty() && result.deadline() != null) {
            String single = result.deadline().trim();
            if (!single.isEmpty() && !single.equalsIgnoreCase("NONE") && !single.equalsIgnoreCase("NULL")) {
                deadlines = List.of(new PriorityAnalysisResult.DeadlineEntry(single, "Deadline"));
            }
        }

        String deadline = result.deadline();
        if (deadline != null) {
            deadline = deadline.trim();
            if (deadline.isEmpty() || deadline.equalsIgnoreCase("NONE") || deadline.equalsIgnoreCase("NULL")) {
                deadline = null;
            }
        }
        if ((deadline == null || deadline.isBlank()) && result.primaryDeadline() != null) {
            String pd = result.primaryDeadline().trim();
            if (!pd.isEmpty() && !pd.equalsIgnoreCase("NONE") && !pd.equalsIgnoreCase("NULL")) {
                deadline = pd;
            }
        }
        if ((deadline == null || deadline.isBlank()) && !deadlines.isEmpty()) {
            deadline = deadlines.get(0).date();
        }

        String primaryDeadline = result.primaryDeadline();
        if (primaryDeadline != null) {
            primaryDeadline = primaryDeadline.trim();
            if (primaryDeadline.isEmpty() || primaryDeadline.equalsIgnoreCase("NONE") || primaryDeadline.equalsIgnoreCase("NULL")) {
                primaryDeadline = null;
            }
        }
        if ((primaryDeadline == null || primaryDeadline.isBlank()) && !deadlines.isEmpty()) {
            primaryDeadline = deadlines.get(0).date();
        }

        String reason = result.reason() != null ? result.reason() : "";

        return new PriorityAnalysisResult(actionDecision, actionItems, deadlines, primaryDeadline, actionItem, deadline, reason);
    }

    private String extractJson(String response) {
        if (response == null) return "";

        response = response
                .replace("```json", "")
                .replace("```", "")
                .trim();

        int start = response.indexOf("{");
        int end = response.lastIndexOf("}");

        if (start != -1 && end != -1 && end > start) {
            return response.substring(start, end + 1);
        }

        return response;
    }

    // New: Generate dashboard for selected emails only
    public PriorityDashboardResponse generatePriorityDashboardForSelectedEmails(List<Gmail> emails) {
        log.info("Generating priority dashboard for {} selected emails...", emails.size());
        List<PriorityDashboardEmail> highPriorityEmails = new ArrayList<>();
        List<String> errors = new ArrayList<>(); // To track errors for missing emails
        int idx = 1;
        for (Gmail email : emails) {
            try {
                PriorityAnalysisResult analysis = analyzePriority(email);
                String prioritizedDeadline = analysis.primaryDeadline();
                if (prioritizedDeadline == null && analysis.deadlines() != null && !analysis.deadlines().isEmpty()) {
                    prioritizedDeadline = analysis.deadlines().get(0).date();
                }

                PriorityDashboardEmail dashboardEmail = new PriorityDashboardEmail(
                    String.valueOf(idx),
                    email.getSubject(),
                    email.getFromAddress(),
                    email.getToAddress(),
                    analysis.actionDecision(),
                    analysis.actionItems() != null && !analysis.actionItems().isEmpty() ? analysis.actionItems().get(0) : "",
                    prioritizedDeadline,
                    analysis.reason(),
                    email.getSubject() != null ? email.getSubject().length() : 0, // Calculate subject length
                    email.getContent() != null ? email.getContent().length() : 0  // Calculate content length
                );
                if (analysis.actionDecision().equals("ACTION_REQUIRED")) {
                    highPriorityEmails.add(dashboardEmail);
                    log.info("Added high-priority email: {}", email.getSubject());
                }
            } catch (IllegalArgumentException | TransientAiException e) {
                log.warn("Error analyzing selected email {}: {}", email.getSubject(), e.getMessage());
                errors.add("Error analyzing email with subject: " + email.getSubject() + ". Reason: " + e.getMessage());
            }
            idx++;
        }
        log.info("Priority dashboard (selected) generated with {} high-priority emails", highPriorityEmails.size());
        if (!errors.isEmpty()) {
            log.warn("Some emails could not be analyzed: {}", errors);
        }
        return new PriorityDashboardResponse(
            highPriorityEmails.size(),
            highPriorityEmails
        );
    }

}
