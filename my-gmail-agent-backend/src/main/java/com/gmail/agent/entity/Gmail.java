package com.gmail.agent.entity;

import lombok.Data;

@Data
public class Gmail {
    private String fromAddress;
    private String toAddress;
    private String subject;
    private String content;
    private String sentDate; // Optional: Include sent date for better context
}
