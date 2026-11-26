import { crc32 } from "node:zlib";

export function fixturePdf(text="The fictional Juniper archive opens on Tuesday.") {
  const stream="BT /F1 14 Tf 30 200 Td ("+text+") Tj ET";
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length "+stream.length+" >>\nstream\n"+stream+"\nendstream"
  ];
  let content="%PDF-1.4\n";
  const offsets=objects.map((object,index)=>{
    const offset=content.length;
    content+=(index+1)+" 0 obj\n"+object+"\nendobj\n";
    return offset;
  });
  const xref=content.length;
  content+="xref\n0 "+(objects.length+1)+"\n0000000000 65535 f \n"+offsets.map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")+
    "trailer\n<< /Size "+(objects.length+1)+" /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF\n";
  return Buffer.from(content);
}

function fixtureZip(entries:[string,string][]) {
  const data:Buffer[]=[], directory:Buffer[]=[];
  let size=0;
  for (const [name,content] of entries) {
    const file=Buffer.from(name), bytes=Buffer.from(content);
    const checksum=crc32(bytes);
    const local=Buffer.alloc(30), central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);
    local.writeUInt32LE(checksum,14);local.writeUInt32LE(bytes.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(file.length,26);
    central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    central.writeUInt32LE(checksum,16);central.writeUInt32LE(bytes.length,20);central.writeUInt32LE(bytes.length,24);
    central.writeUInt16LE(file.length,28);central.writeUInt32LE(size,42);
    data.push(local,file,bytes);directory.push(central,file);size+=local.length+file.length+bytes.length;
  }
  const records=Buffer.concat(directory), end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
  end.writeUInt32LE(records.length,12);end.writeUInt32LE(size,16);
  return Buffer.concat([...data,records,end]);
}

export function fixtureDocx(text="The fictional Alder reading room needs a reservation.", extra:[string,string][] = []) {
  return fixtureZip([
    ["[Content_Types].xml",'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ["word/document.xml",'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>'+text+'</w:t></w:r></w:p></w:body></w:document>'],
    ...extra
  ]);
}
