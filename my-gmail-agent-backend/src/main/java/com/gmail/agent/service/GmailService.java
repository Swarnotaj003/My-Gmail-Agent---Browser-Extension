package com.gmail.agent.service;

import com.gmail.agent.entity.Gmail;
import lombok.extern.slf4j.Slf4j;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
@Slf4j
public class GmailService {
    private final ChatClient chatClient;

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
        log.info("Generating reply for the email with subject: {}", gmail.getSubject());

        // call the model with prompt template
        String reply = "";
        try {
            long startTime = System.currentTimeMillis();

            String response = chatClient.prompt()
                    .user(u -> {
                        u.text(template);
                        u.params(Map.of(
                                "subject", gmail.getSubject(),
                                "content", gmail.getContent(),
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

    public String generateSummary(Gmail gmail, String style) {
        if (!validateMailInput(gmail)) {
            log.warn("generateSummary() called with invalid input: Gmail object is null or empty subject/content!");
            throw new IllegalArgumentException("Subject & content cannot be null or empty");
        }

        String template = """
        Summarize the following email content clearly and concisely.
        Provide a {style} style summary that captures the key points without extra details.
        Subject: {subject}
        Content: {content}
        Style can be one of the following:
        SHORT: Generate a 1–2 sentence summary capturing only the main intent of the email.
        BULLET POINTS: Summarize key information in form a list of bullet points highlighting actions, deadlines, and decisions.
        DETAILED: Produce a comprehensive summary covering context, important details, and next steps in a paragraph of upto 100 words.
        """;

        log.info("Generating '{}' style summary for the email with subject: {}", style, gmail.getSubject());

        String summary = "";
        try {
            long startTime = System.currentTimeMillis();

            String response = chatClient.prompt()
                    .user(u -> {
                        u.text(template);
                        u.params(Map.of(
                                "subject", gmail.getSubject(),
                                "content", gmail.getContent(),
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

}
