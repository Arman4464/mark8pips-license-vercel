import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const templates = {
  order_confirmation: 'd-1234567890abcdef', // Replace with actual template IDs
  payment_success: 'd-abcdef1234567890',
  license_expiry_warning: 'd-567890abcdef1234',
  new_order_admin: 'd-fedcba0987654321'
};

export async function sendEmail({ to, template, data, from = 'noreply@mark8pips.com' }) {
  try {
    const msg = {
      to,
      from: {
        email: from,
        name: 'Mark8Pips Support'
      },
      templateId: templates[template],
      dynamicTemplateData: data
    };
    
    await sgMail.send(msg);
    console.log(`Email sent successfully to ${to} using template ${template}`);
    
  } catch (error) {
    console.error('Email sending error:', error);
    throw error;
  }
}

// Bulk email function for marketing
export async function sendBulkEmail({ recipients, template, globalData = {} }) {
  try {
    const msg = {
      from: {
        email: 'marketing@mark8pips.com',
        name: 'Mark8Pips Team'
      },
      templateId: templates[template],
      personalizations: recipients.map(recipient => ({
        to: [{ email: recipient.email }],
        dynamicTemplateData: { ...globalData, ...recipient.data }
      }))
    };
    
    await sgMail.sendMultiple(msg);
    console.log(`Bulk email sent to ${recipients.length} recipients`);
    
  } catch (error) {
    console.error('Bulk email error:', error);
    throw error;
  }
}
