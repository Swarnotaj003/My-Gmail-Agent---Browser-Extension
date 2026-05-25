package com.gmail.agent.entity;

import java.time.LocalDateTime;

import lombok.Data;

@Data
public class Gmail {
    private String fromAddress;
    private String toAddress;
    private String subject;
    private String content;
    private String sentDate; 
    private LocalDateTime timestamp;
}
