package com.gmail.agent.service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import com.gmail.agent.entity.Gmail;

import lombok.extern.slf4j.Slf4j;

@Service
@Slf4j
public class GmailService {
    private final ChatClient chatClient;
    private final int MAX_INPUT_CHARS = 4000; 

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

}
